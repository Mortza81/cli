import klaw from 'klaw';
import hash from './hash';
import through2 from 'through2';
import { relative, join, basename, dirname } from 'path';
import fs, { readFile, readFileSync, existsSync } from 'fs-extra';
import ignore from 'ignore';

const defaultIgnores = [
  '.git',
  '.idea',
  '.vscode',
  '.gitignore',
  '.liaraignore',
  '*.*~',
  'node_modules',
  'bower_components'
];

const addNestedGitignores = function (ignoreInstance, projectPath) {
  ignoreInstance.add(defaultIgnores);

  return through2.obj(function (item, enc, next) {
    if(basename(item.path) === '.gitignore') {
      const removeEmptyLines = lines => lines.filter(line => line.trim().length > 0);
      const patterns = removeEmptyLines(
        readFileSync(item.path).toString().split('\n')
      );

      const relativeToProjectPath = patterns.map(pattern => relative(projectPath, join(dirname(item.path), pattern)));

      ignoreInstance.add(relativeToProjectPath);
    }

    this.push(item);
    return next();
  });
};

const ignoreFiles = function (ignoreInstance, projectPath) {
  const liaragnorePath = join(projectPath, '.liaraignore');
  const gitignorePath = join(projectPath, '.gitignore');

  if(existsSync(liaragnorePath)) {
    ignoreInstance = ignore({ ignorecase: false });
    ignoreInstance.add(defaultIgnores);
    ignoreInstance.add(readFileSync(liaragnorePath).toString());
  }

  return through2.obj(function (item, enc, next) {
    const itemPath = relative(projectPath, item.path);
    if(itemPath && ! ignoreInstance.ignores(relative(projectPath, item.path))) {
      this.push(item);
    }
    return next();
  });
};

export default async function getFiles(projectPath) {
  const mapHashesToFiles = new Map;
  const directories = [];

  const ignoreInstance = ignore({ ignorecase: false });

  await new Promise(resolve => {
    const files = [];

    klaw(projectPath)
      .pipe(addNestedGitignores(ignoreInstance, projectPath))
      .pipe(ignoreFiles(ignoreInstance, projectPath))
      .on('data', file => files.push(file))
      .on('end', async () => {
        await Promise.all(files.map(async ({ path, stats }) => {

          const mode755 = 16893;
          const mode644 = 33204;

          if( ! stats.isFile()) {
            const dir = {
              name: relative(projectPath, path),
              mode: mode755,
              type: 'directory',
            };

            return directories.push(dir);
          }

          const data = await readFile(path);
          const checksum = hash(data);

          const file = {
            checksum,
            path: relative(projectPath, path),
            size: stats.size,
          };

          try {
            // Is file executable?
            await fs.access(path, fs.constants.X_OK);

            file.mode = mode755;

          } catch (_) {
            // File is not executable.
            file.mode = mode644;
          }

          if(mapHashesToFiles.has(checksum)) {
            const { files } = mapHashesToFiles.get(checksum);
            mapHashesToFiles.set(checksum, {
              data,
              files: [...files, file],
            });
          } else {
            mapHashesToFiles.set(checksum, {
              data,
              files: [file],
            });
          }
        }));
        resolve();
      });
  });

  // flatten files
  const files = Array
    .from(mapHashesToFiles)
    .reduce((prevFiles, [ checksum, { files } ]) => {
      return [
        ...prevFiles,
        ...files,
      ];
    }, []);

  return { files, directories, mapHashesToFiles };
}