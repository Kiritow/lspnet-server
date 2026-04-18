import path from "node:path";
import { inspect } from "node:util";
import {
    createLogger,
    format,
    transports,
    Logger as WinstonLogger,
} from "winston";
import dayjs from "dayjs";

const stackReg = /^(?:\s*)at (?:(.+) \()?(?:([^(]+?):(\d+):(\d+))\)?$/;

function parseError(err: Error, skip: number) {
    try {
        const stacklines = err.stack?.split("\n").slice(skip);
        if (!stacklines?.length) {
            return undefined;
        }

        const lineMatch = stackReg.exec(stacklines[0]);
        if (!lineMatch || lineMatch.length < 5) {
            return undefined;
        }

        let className = "";
        let functionName = "";
        let functionAlias = "";
        if (lineMatch[1] && lineMatch[1] !== "") {
            [functionName, functionAlias] = lineMatch[1]
                .replace(/[[\]]/g, "")
                .split(" as ");
            functionAlias = functionAlias || "";

            if (functionName.includes(".")) {
                [className, functionName] = functionName.split(".");
            }
        }

        return {
            className,
            functionName,
            functionAlias,
            callerName: lineMatch[1] || "",
            fileName: lineMatch[2],
            lineNumber: parseInt(lineMatch[3], 10),
            columnNumber: parseInt(lineMatch[4], 10),
        };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
        return undefined;
    }
}

function lineNumber(backtraceLevel: number) {
    const stk = parseError(new Error(), backtraceLevel + 2);
    if (stk === undefined) {
        return "<unknown>";
    }
    return `${path.basename(stk.fileName)}:${stk.lineNumber}`;
}

interface LoggerOptions {
    level: string;
    filename?: string;
    logpath?: string;

    file?: boolean;
    console?: boolean;
}

export class Logger {
    _logger: WinstonLogger;

    constructor(options: LoggerOptions) {
        this._logger = createLogger({
            level: options.level,
            format: format.combine(
                format.errors({ stack: false }),
                format.simple(),
                format.colorize()
            ),
            transports: [],
        });

        if (options?.file) {
            const logpath = options.logpath;
            const filename = options.filename;

            if (logpath === undefined || filename === undefined) {
                throw new Error(
                    "logpath and filename must be set when file is true"
                );
            }

            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, `${filename}.log`),
                    level: "info",
                })
            );
            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, `${filename}_error.log`),
                    level: "error",
                })
            );
            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, "debug.log"),
                    level: "debug",
                })
            );
        }

        if (options?.console || options?.file === undefined) {
            this._logger.add(
                new transports.Console({
                    level: options.level,
                    format: format.combine(
                        format.errors({ stack: false }),
                        format.simple()
                    ),
                })
            );
        }
    }

    getMessage(level: string, ...args: unknown[]) {
        const transArgs = args.map((a) => {
            switch (typeof a) {
                case "undefined":
                    return "undefined";
                case "string":
                    return a;
                case "number":
                case "boolean":
                case "symbol":
                case "bigint":
                    return a.toString();
                case "function":
                    return inspect(a);
                case "object": {
                    if (a === null) return "null";

                    if (a instanceof Error) {
                        return inspect(a);
                    }

                    return JSON.stringify(a, (_, v: unknown) =>
                        typeof v === "bigint" ? v.toString() : v
                    );
                }
            }
        });
        return `${dayjs().format("YYYY-MM-DD HH:mm:ss")} ${lineNumber(2)} [${level.toUpperCase()}] (${process.pid}) ${transArgs.join(" ")}`;
    }

    debug(...args: unknown[]) {
        this._logger.debug(this.getMessage("debug", ...args));
    }

    info(...args: unknown[]) {
        this._logger.info(this.getMessage("info", ...args));
    }

    warn(...args: unknown[]) {
        this._logger.warn(this.getMessage("warn", ...args));
    }

    error(...args: unknown[]) {
        this._logger.error(this.getMessage("error", ...args));
    }
}

const loggerMaps = new Map<string, Logger>();

export default function getOrCreateLogger(
    name: string,
    options?: LoggerOptions
): Logger {
    if (loggerMaps.has(name)) return loggerMaps.get(name)!;

    const l = new Logger(
        Object.assign(
            {
                filename: name,
                logpath: "./",
                level: "info",
            },
            options
        )
    );
    loggerMaps.set(name, l);
    return l;
}
