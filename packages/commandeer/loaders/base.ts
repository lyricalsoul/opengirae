import { info } from "@girae/common/logger"
import { readdirSync } from "fs"
import { join } from "path"

// Base for anything that dynamically import()s every file under a directory at commandeer
// startup (currently commands and hooks) - owns the "scan a directory, import() each file,
// log how many loaded" primitive so it isn't reimplemented per loader.
export abstract class Loadable {
  protected abstract readonly label: string

  protected async importAll(dirPath: string): Promise<{ file: string; module: any }[]> {
    const files = readdirSync(dirPath)
    const modules = await Promise.all(files.map(file => import(join(dirPath, file)).then(m => m.default)))
    return files.map((file, i) => ({ file, module: modules[i] }))
  }

  protected logLoaded(count: number) {
    info("commandeer", `Loaded ${count} ${this.label}`)
  }
}
