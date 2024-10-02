import { InfluxDB, Point, WriteApi } from "@influxdata/influxdb-client";

export class InfluxAPI {
    db: InfluxDB;
    writeClient: WriteApi;

    constructor(influxDBClient: InfluxDB, org: string, bucket: string) {
        this.db = influxDBClient;
        this.writeClient = influxDBClient.getWriteApi(org, bucket);
    }

    async flush() {
        await this.writeClient.flush();
    }

    writeInt(measure: string, value: number, tags: { [key: string]: string }) {
        const p = new Point(measure).intField("value", value);
        if (tags != null) {
            Object.keys(tags).forEach((k) => p.tag(k, tags[k]));
        }
        console.log(p);
        this.writeClient.writePoint(p);
    }

    writeMultiInt(
        measure: string,
        values: { [key: string]: number },
        tags: { [key: string]: string }
    ) {
        const p = new Point(measure);
        Object.keys(values).forEach((k) => p.intField(k, values[k]));
        if (tags != null) {
            Object.keys(tags).forEach((k) => p.tag(k, tags[k]));
        }
        console.log(p);
        this.writeClient.writePoint(p);
    }
}
