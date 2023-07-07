const { Point } = require("@influxdata/influxdb-client")

class InfluxAPI {
    constructor(influxDBClient, org, bucket) {
        this.db = influxDBClient
        this.writeClient = influxDBClient.getWriteApi(org, bucket)
    }

    async flush() {
        await this.writeClient.flush()
    }

    writeInt(measure, value, tags) {
        const p = new Point(measure).intField('value', value)
        if (tags != null) {
            Object.keys(tags).forEach(k => p.tag(k, tags[k]))
        }
        console.log(p)
        this.writeClient.writePoint(p)
    }

    writeMultiInt(measure, values, tags) {
        const p = new Point(measure)
        Object.keys(values).forEach(k => p.intField(k, values[k]))
        if (tags != null) {
            Object.keys(tags).forEach(k => p.tag(k, tags[k]))
        }
        console.log(p)
        this.writeClient.writePoint(p)
    }
}

module.exports = InfluxAPI
