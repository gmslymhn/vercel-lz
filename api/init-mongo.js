const mongoCache = require('./mongo-cache');

async function init() {
    try {
        const collection = await mongoCache.connect();

        // 创建TTL索引，自动过期删除
        await collection.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 }
        );

        // 创建fid的唯一索引
        await collection.createIndex(
            { _id: 1 },
            { unique: true }
        );

        console.log('MongoDB 索引初始化完成');
    } catch (e) {
        console.error('初始化失败:', e);
    } finally {
        await mongoCache.close();
    }
}

init();
