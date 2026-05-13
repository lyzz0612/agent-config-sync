import chalk from "chalk";

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export const logger = {
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  },
  success(message: string): void {
    process.stdout.write(`${chalk.green("✓")} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${chalk.yellow("!")} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${chalk.red("✗")} ${message}\n`);
  },
  debug(message: string): void {
    if (verbose) {
      process.stderr.write(`${chalk.gray("·")} ${message}\n`);
    }
  },
  dim(message: string): void {
    process.stdout.write(`${chalk.dim(message)}\n`);
  },
};
