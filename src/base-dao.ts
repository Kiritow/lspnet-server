import { Logger } from "./base-log";
import * as mysql from "mysql";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryResultType = any;

export class BaseConnection {
    conn: mysql.PoolConnection;
    logger?: Logger;

    constructor(mysqlConn: mysql.PoolConnection, logger?: Logger) {
        this.conn = mysqlConn;
        this.logger = logger;
    }

    begin(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug("begin");
            this.conn.beginTransaction((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    rollback(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug("rollback");
            this.conn.rollback((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    commit(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug("commit");
            this.conn.commit((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    async queryEx(
        sql: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: any
    ): Promise<{ results: QueryResultType; fields?: mysql.FieldInfo[] }> {
        if (this.logger) this.logger.debug(sql, params);
        return new Promise((resolve, reject) => {
            this.conn.query(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params: any) {
        return (await this.queryEx(sql, params)).results;
    }

    release() {
        this.conn.release();
    }

    close() {
        this.conn.destroy();
    }
}

export class BaseDaoClass {
    pool: mysql.Pool;
    logger?: Logger;

    constructor(mysqlOptions: mysql.PoolConfig, logger?: Logger) {
        this.pool = mysql.createPool(mysqlOptions);
        this.logger = logger;
    }

    // Utils
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async queryEx(
        sql: string,
        params: unknown
    ): Promise<{ results: QueryResultType; fields?: mysql.FieldInfo[] }> {
        if (this.logger) this.logger.debug(sql, params);
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    async query(sql: string, params: unknown) {
        return (await this.queryEx(sql, params)).results;
    }

    // call release or destroy on Connection object later.
    /**
     * @returns {Promise<BaseConnection>}
     */
    async getConnection() {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((err, conn) => {
                if (err) {
                    return reject(err);
                }

                return resolve(new BaseConnection(conn, this.logger));
            });
        });
    }
}
