const https = require('https');
const { URL } = require('url');

module.exports = async (req, res) => {
    try {
        const { fid, pwd, isNewd = 'https://innlab.lanzn.com/' } = req.query;

        if (!fid) {
            return res.status(400).send('缺少必要参数: fid');
        }

        // 第一步：获取文件页面HTML
        const htmlText = await fetchUrl(`https://innlab.lanzn.com/${fid}`, {
            headers: {
                'Referer': isNewd,
            }
        });

        // 提取文件URL和sign值
        const fileurl = extractValue(htmlText, /url\s*:\s*['"]([^'"]+?)['"],/);
        const signs = extractAllMatches(htmlText, /'sign':'([^']+)'/g);

        console.log("fileurl",fileurl)
        console.log("signs",signs)
        if (!fileurl || signs.length < 2) {
            throw new Error('解析HTML失败：缺少关键数据');
        }

        // 第二步：提交验证信息
        const postData = new URLSearchParams({
            action: "downprocess",
            sign: signs[1],
            p: pwd || '',
            kd: 1
        }).toString();

        const postResponse = await fetchUrl(`https://innlab.lanzn.com${fileurl}`, {
            method: 'POST',
            headers: {
                'Referer': `https://innlab.lanzn.com/${fid}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: postData
        });

        const result = JSON.parse(postResponse);
        console.log(result)
        if (result.zt !== 1) {
            throw new Error(result.inf || '文件解析失败');
        }

        // 302重定向到下载链接
        res.redirect(302, `${result.dom}/file/${result.url}`);
    } catch (error) {
        console.error('解析失败:', error);
        res.status(500).send(`解析失败: ${error.message}`);
    }
};

// 使用原生https模块实现HTTP请求
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const { hostname, pathname, search } = new URL(url);
        const req = https.request({
            hostname,
            path: pathname + (search || ''),
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                } else {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// 辅助函数：提取单个匹配值
function extractValue(text, regex) {
    const match = regex.exec(text);
    return match ? match[1] : null;
}

// 辅助函数：提取所有匹配值
function extractAllMatches(text, regex) {
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}