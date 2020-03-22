import * as core from '@actions/core'
import * as exec from '@actions/exec'
import {LockfileParser} from '@snyk/cocoapods-lockfile-parser'
import table from 'markdown-table'

async function run(): Promise<void> {
  try {
    const currentLockfile: LockfileParser = await LockfileParser.readFile(
      './Podfile.lock'
    )

    const podUpdate = await exec.exec('bundle exec pod update')

    if (podUpdate !== 0) {
      throw new Error('Pod Update Failed')
    }

    const newLockfile: LockfileParser = await LockfileParser.readFile(
      './Podfile.lock'
    )

    if (currentLockfile.podfileChecksum === newLockfile.podfileChecksum) {
      core.info('Pods are already up-to-date')
      return
    }

    const updates = getUpdates(currentLockfile, newLockfile)
    const updateRows = updates.map(update => {
      return update.tableRow
    })
    const markdownTable = table([
      ['Name', 'Old Version', 'New Version'],
      ...updateRows
    ])

    core.debug(markdownTable)
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
