import ora from 'ora';
import axios from 'axios';
import bytes from 'bytes';
import stream from 'stream';
import retry from 'async-retry';
import { basename, join } from 'path';
import inquirer, { prompt } from 'inquirer';
import { existsSync, readJSONSync } from 'fs-extra';
import { white, cyan, gray, green, red } from 'chalk';

import showError from '../util/error';
import auth from '../middlewares/auth';
import getFiles from '../util/get-files';
import getPort from '../util/get-port';
import eraseLines from '../util/erase-lines';
import detectDeploymentType from '../util/detect-deployment-type';
import ensureAppHasDockerfile from '../util/ensure-has-dockerfile';

export default auth(async function deploy(args, config) {
  const spinner = ora('Loading projects...').start();

  const { project, path, debug, dev } = args;

  let port;
  let platform;
  let projectId = typeof project === 'boolean' ? null : project;
  const projectPath = path ? path : process.cwd();
  const liaraJSONPath = join(projectPath, 'liara.json');

  const APIConfig = {
    baseURL: config.apiURL,
    headers: {
      Authorization: `Bearer ${config.api_token}`,
    }
  };

  const clearAndLog = (...texts) => {
    spinner.clear();
    spinner.frame();
    console.log(...texts);
  }

  const logInfo = (title, value) => {
    clearAndLog(`${gray(`${title}:`)} ${value}`);
  }

  const hasLiaraJSONFile = existsSync(liaraJSONPath);
  if (hasLiaraJSONFile) {
    let liaraJSON;

    try {
      liaraJSON = readJSONSync(liaraJSONPath) || {};
    } catch (error) {
      throw new Error('Syntax error in `liara.json`!');
    }

    if (!project) {
      projectId = liaraJSON.project;
    }

    if (liaraJSON.port) {
      port = Number(liaraJSON.port);
      if (isNaN(port)) {
        throw new TypeError('The `port` field in `liara.json` must be a number.');
      }
    }

    platform = liaraJSON.platform;
    if (platform && typeof platform !== 'string') {
      throw new TypeError('The `platform` field in `liara.json` must be a string.');
    }
  }

  if (!projectId) {
    let promptResult;

    const { data: { projects } } = await axios.get(`/v1/projects`, APIConfig);

    spinner.stop();

    if ( ! projects.length) {
      console.info('Please go to http://console.liara.ir/projects and create a project, first.');
      process.exit(1);

    } else {
      promptResult = await prompt({
        name: 'projectId',
        type: 'list',
        message: 'Please select a project:',
        choices: [
          ...projects.map(project => project.project_id),
        ]
      });
    }

    projectId = promptResult.projectId;
  }

  spinner.start('Deploying...');

  logInfo('Project', projectId);
  logInfo('Deploying', projectPath);

  if (platform) {
    logInfo('Platform', platform);
  } else {
    platform = detectDeploymentType(args, projectPath);
    logInfo('Detected platform', platform);
  }

  debug && console.time('[debug] making hashes')
  const { files, directories, mapHashesToFiles } = await getFiles(projectPath);
  debug && console.log('[debug] files count:', files.length);
  debug && console.timeEnd('[debug] making hashes');

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  logInfo('Project size', bytes(totalBytes));

  debug && console.time('[debug] Ensure app has Dockerfile');
  const { filesWithDockerfile, mapHashesToFilesWithDockerfile } =
    ensureAppHasDockerfile(platform, files, mapHashesToFiles);
  debug && console.timeEnd('[debug] Ensure app has Dockerfile');

  if (!port) {
    port = getPort(platform);
    debug && console.log('[debug] default port:', port);
  }

  try {
    await retry(async bail => {
      const body = {
        port,
        directories,
        type: platform,
        project: projectId,
        files: filesWithDockerfile,
      };
  
      const url = `/v1/projects/${projectId}/releases`;
  
      try {
        debug && console.time('stream');
        const { data: stream } = await axios.post(url, body, {
          ...APIConfig,
          responseType: 'stream'
        });
  
        spinner.start('Building...');
  
        stream
          .on('data', data => {
            const line = JSON.parse(data.toString().slice(6));
  
            if (line.state === 'BUILD_FINISHED') {
              spinner.succeed('Build finished.');
              spinner.start('Pushing the image...');
              return;
            }
  
            if (line.state === 'CREATING_SERVICE') {
              spinner.succeed('Image pushed.');
              spinner.start('Starting the service...');
              return;
            }
  
            if (line.state === 'FAILED') {
              spinner.stop();
  
              console.log();
              console.log(red('Deployment failed :('));
              console.log('Please try again later or contact us.');
              console.log();
            }
  
            if (line.state === 'READY') {
              spinner.stop();
  
              console.log();
              console.log(green('Deployment finished successfully.'));
              console.log(white('Open up the url below in your browser:'));
              console.log()
              dev
                ? console.log(`    ${cyan(`http://${projectId}.liara.localhost`)}`)
                : console.log(`    ${cyan(`http://${projectId}.liara.run`)}`);
              console.log();
  
              return;
            }
  
            if(line.message) {
              clearAndLog(cyan('>'), line.message.trim());
            }
          })
          .on('end', () => {
            debug && console.log('Stream finished.');
            debug && console.timeEnd('stream');
          });
  
      }
      catch (error) {
        const { response } = error;
  
        // Unknown error
        if (!response) return bail(error);
  
        const data = await new Promise(resolve =>
          error.response.data.on('data', data => resolve(JSON.parse(data)))
        );

        if(response.status === 402) {
          spinner.fail(`You don't have enough balance. Payment required.`);
          process.exit(1);
        }

        if(response.status === 400 && data.message === 'frozen_project') {
          spinner.fail(`Project is frozen (not enough balance).
Please open up http://console.liara.ir/projects and unfreeze the project.`);
          process.exit(1);
        }

        if (response.status === 400 && data.message === 'missing_files') {
          const { missing_files } = data;
  
          debug && console.log(`[debug] missing files: ${missing_files.length}`);
  
          spinner.start('Uploading...');
  
          await uploadMissingFiles(
            mapHashesToFilesWithDockerfile,
            missing_files,
            config,
          );
  
          spinner.succeed('Upload finished.');
  
          throw error; // retry deployment
        }
  
        if (response.status >= 400 && response.status < 500) {
          return bail(error);
        }
      }
  
    }, {
        onRetry() {
          debug && console.log('[debug] Retrying deployment...');
        }
      });
  } catch (error) {
    debug && console.error(error);
    spinner.fail(error.message);
    console.info('Sorry for inconvenience. Please contact us.');
  }
});

function uploadMissingFiles(mapHashesToFiles, missing_files, config) {
  return new Promise.all(missing_files.map(file => {
    const { data } = mapHashesToFiles.get(file);

    const dataStream = new stream.PassThrough();
    dataStream.end(data);

    return axios({
      method: 'post',
      url: '/v1/files',
      baseURL: config.apiURL,
      data: dataStream,
      headers: {
        'X-File-Digest': file,
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${config.api_token}`,
      },
    });
  }));
}