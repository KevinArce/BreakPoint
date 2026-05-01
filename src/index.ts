import { Probot } from 'probot'
import { handlePullRequest } from './handlers/pull-request.js'
import { handleLabelOverride } from './handlers/label-override.js'

export default (app: Probot): void => {
  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    handlePullRequest,
  )

  app.on('pull_request.labeled', handleLabelOverride)
}
