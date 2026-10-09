import cli from "../package.json" with { type: "json" };

/**
 * The engine version a record names.
 *
 * Read from the package rather than written here, so the development run
 * (tsx) and the bundled binary report the same thing.
 */
export const VERSION: string = cli.version;

export const ENGINE = `qed ${VERSION}`;
