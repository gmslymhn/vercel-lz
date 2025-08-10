const { MongoClient } = require('mongodb');
const CONNECTION_STRING = "mongodb+srv://gmslymhn:dNMKZeFiAXn3P856@gm.oxqdnlc.mongodb.net/?retryWrites=true&w=majority&appName=gm";

class MongoCache {
    constructor() {
        this.client = new MongoClient(CONNECTION_STRING, {
            serverApi: {
                version: '1',
                strict: true,
                deprecationErrors: true,
            },
            maxPoolSize: 10,  // 推荐显式设置连接池
            minPoolSize: 2
        });
        this.dbName = 'lz';
        this.collectionName = 'url_cache';
        this.cacheTTL = 600; // 10分钟缓存(秒)
    }

    async connect() {
        if (!this.connected) {
            await this.client.connect();
            this.connected = true;
        }
        return this.client.db(this.dbName).collection(this.collectionName);
    }

    async get(fid) {
        const collection = await this.connect();
        const doc = await collection.findOne({
            _id: fid,
            expiresAt: { $gt: new Date() }
        });
        return doc ? doc.url : null;
    }

    async set(fid, url) {
        const collection = await this.connect();
        await collection.updateOne(
            { _id: fid },
            {
                $set: {
                    url,
                    expiresAt: new Date(Date.now() + this.cacheTTL * 1000),
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    }

    async close() {
        if (this.connected) {
            await this.client.close();
            this.connected = false;
        }
    }
}

// 单例模式导出
module.exports = new MongoCache();
