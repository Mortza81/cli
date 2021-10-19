import axios from 'axios'

import Command from '../base'
import {createDebugLogger} from '../utils/output'

export default class Start extends Command {
  static description = 'start an app'

  static flags = Command.flags

  static args = [{ name: 'app' }]

  async run() {
    const {args, flags} = this.parse(Start)

    const debug = createDebugLogger(flags.debug)

    this.setAxiosConfig({
      ...this.readGlobalConfig(),
      ...flags,
    })

    try {
      await axios.post(`/v1/projects/${args.app}/actions/scale`, { scale: 1 }, this.axiosConfig);

      this.log(`App ${args.app} started.`);

    } catch (error) {
      debug(error.message);

      if(error.response && error.response.data) {
        debug(JSON.stringify(error.response.data));
      }

      if(error.response && error.response.status === 404) {
        this.error(`Could not find the app.`);
      }

      if(error.response && error.response.status === 409) {
        this.error(`Another operation is already running. Please wait.`);
      }

      this.error(`Could not start the app. Please try again.`);
    }
  }
}
