import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {GitHub, context} from '@actions/github'
import {LockfileParser} from '@snyk/cocoapods-lockfile-parser'
import table from 'markdown-table'
import * as process from 'process'

async function run(): Promise<void> {
  try {
    const updateCmd = core.getInput('update_cmd')
    const workingDir = core.getInput('working_dir')
    const token = core.getInput('token')
    const baseBranch = core.getInput('base_branch')
    const commitEmail = core.getInput('commit_email')
    const commitUsername = core.getInput('commit_username')
    const commitTitle = core.getInput('commit_title')

    // by default this is just the root directory
    process.chdir(workingDir)

    // take a snapshot of the current lockfile before updating it
    const currentLockfile: LockfileParser = await LockfileParser.readFile(
      './Podfile.lock'
    )

    // run the update command
    const podUpdate = await exec.exec(updateCmd)

    if (podUpdate !== 0) {
      throw new Error('Pod Update Failed')
    }

    // take a new snapshot to compare the before and after
    const newLockfile: LockfileParser = await LockfileParser.readFile(
      './Podfile.lock'
    )

    const updates = getUpdates(currentLockfile, newLockfile)

    if (updates.length === 0) {
      core.info('Pods are all up-to-date')
      return
    }

    const updateRows = updates.map(update => {
      return update.tableRow
    })
    const markdownTable = table([
      ['Name', 'Old Version', 'New Version'],
      ...updateRows
    ])

    core.info('Packages were updated:')
    core.info(markdownTable)

    const github = new GitHub(token)

    const timestamp = Math.round((new Date()).getTime() / 1000);
    const branch = `update_pods/${ timestamp }`

    if (0 !== await exec.exec(`git config --global user.name ${ commitUsername }`)) {
      throw Error("Couldn't set Username")
    }

    if (0 !== await exec.exec(`git config --global user.email ${ commitEmail }`)) {
      throw Error("Couldn't set Email")
    }
    if (0 !== await exec.exec(`git checkout -b ${ branch }`)) {
      throw Error("Couldn't create a new Branch")
    }
    if (0 !== await exec.exec('git add Podfile.lock')) {
      throw Error("Couldn't add Podfile")
    }
    if (0 !== await exec.exec(`git commit -m ${ commitTitle }`)) {
      throw Error("Couldn't create commit")
    }
    if (0 !== await exec.exec(`git push -f https://x-access-token:${token}@github.com/${context.repo.owner}/${context.repo.repo}.git HEAD:refs/heads/${branch}`)) {
      throw Error("Couldn't couldn't push")
    }
  
    const createRequest = await github.pulls.create({
      ...context.repo,
      title: commitTitle,
      base: baseBranch,
      head: branch,
      body: markdownTable,
      maintainer_can_modify: true
    })

    if (!(createRequest.status >= 200 && createRequest.status < 300)) {
      throw Error(`Error creating pull request. Status: ${ createRequest.status }`)
    }

  } catch (error) {
    core.setFailed(error.message)
  }
}

class DependencyUpdate {
  name: string
  oldVersion: string
  newVersion: string

  get tableRow(): string[] {
    return [this.name, this.oldVersion, this.newVersion]
  }

  constructor(name: string, oldVersion: string, newVersion: string) {
    this.name = name
    this.oldVersion = oldVersion
    this.newVersion = newVersion
  }
}

function getUpdates(
  oldLock: LockfileParser,
  newLock: LockfileParser
): DependencyUpdate[] {
  const updates: DependencyUpdate[] = []

  const oldGraph = oldLock.toDepGraph()
  const oldPkgs = oldGraph.getPkgs()
  const newGraph = newLock.toDepGraph()
  const newPkgs = newGraph.getPkgs()

  for (const oldPkg of oldPkgs) {
    for (const newPkg of newPkgs) {
      if (
        newPkg.name === oldPkg.name &&
        oldPkg.version &&
        newPkg.version &&
        oldPkg.version !== newPkg.version
      ) {
        const update = new DependencyUpdate(
          oldPkg.name,
          oldPkg.version,
          newPkg.version
        )
        updates.push(update)
      }
    }
  }

  return updates
}

run()
