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
// 获取最终下载URL
        const intermediateUrl = `${result.dom}/file/${result.url}`;
        const finalUrl = await getFinalRedirectUrl(intermediateUrl);
        console.log("finalUrl",finalUrl)
        // 302重定向到最终下载链接
        res.redirect(302, finalUrl);
    } catch (error) {
        console.error('解析失败:', error);
        res.status(500).send(`解析失败: ${error.message}`);
    }
};


// 新增函数：获取重定向后的最终URL
function getFinalRedirectUrl(url) {
    return new Promise((resolve, reject) => {
        const { hostname, pathname, search } = new URL(url);

        const req = https.request({
            hostname,
            path: pathname + (search || ''),
            method: 'GET',
            headers: {//我是浏览器我是浏览器我是浏览器
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
                'cookie': 'down_ip=1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0'
            },
            maxRedirects: 0
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const location = res.headers.location;
                const finalUrl = location.startsWith('http') ?
                    location :
                    `https://${hostname}${location}`;
                resolve(finalUrl);
            } else {
                resolve(url);
            }
            res.on('data', () => {});
        });

        req.on('error', (err) => {
            console.error('获取重定向URL失败:', err);
            resolve(url);
        });

        req.end();
    });
}



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