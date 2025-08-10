const mongoCache = require('./mongo-cache');

async function init() {
    try {
        const collection = await mongoCache.connect();

        // ✅ 只保留必要的 TTL 索引
        await collection.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 }
        );

        // ✅ 如果需要其他字段的唯一索引（例如 fid）
        // await collection.createIndex(
        //     { fid: 1 },
        //     { unique: true }
        // );

        console.log('MongoDB 索引初始化完成');
    } catch (e) {
        console.error('初始化失败:', e);
        process.exit(1); // 非零退出码表示错误
    } finally {
        await mongoCache.close();
    }
}

init();
