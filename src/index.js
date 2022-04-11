const core = require('@actions/core');
const github = require('@actions/github');
const run = require('./login');

try {
  const email = core.getInput('email', { required: true })
  const password = core.getInput('password', { required: true })
  await run(email, password);
} catch (error) {
  core.setFailed(error.message);
}
