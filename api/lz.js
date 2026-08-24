const https = require('https');
const { URL } = require('url');
const mongoCache = require('./mongo-cache');
const zlib = require('zlib');

// 移除重复的 console.time('mongodb')
console.time('lz');

module.exports = async (req, res) => {
    try {
        const { fid, pwd, isNewd = 'https://innlab.lanzn.com/' } = req.query;

        if (!fid) {
            return res.status(400).send('缺少必要参数: fid');
        }

        // 1. 检查缓存
        const cachedUrl = await mongoCache.get(fid);
        if (cachedUrl) {
            console.log(`[缓存命中] fid=${fid}`);
            return res.redirect(302, cachedUrl);
        }

        console.log(`[缓存未命中] 开始解析 fid=${fid}`);

        // 2. 获取HTML内容（处理反爬挑战）
        let htmlText = await fetchUrlWithChallenge(`https://innlab.lanzn.com/${fid}`, {
            headers: {
                'Referer': isNewd,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
            }
        });

        console.log(`htmlText长度: ${htmlText.length}`);

        const fileurl = extractValue(htmlText, /url\s*:\s*['"]([^'"]+?)['"],/);
        const signs = extractAllMatches(htmlText, /'sign':'([^']+)'/g);

        if (!fileurl || signs.length < 2) {
            throw new Error('解析HTML失败：缺少关键数据');
        }

        console.log(`提取到fileurl: ${fileurl}, signs数量: ${signs.length}`);

        const postData = new URLSearchParams({
            action: "downprocess",
            sign: signs[1],
            p: pwd || '',
            kd: 1
        }).toString();

        // 3. 提交POST请求（同样需要处理反爬挑战）
        const postResponse = await fetchUrlWithChallenge(`https://innlab.lanzn.com${fileurl}`, {
            method: 'POST',
            headers: {
                'Referer': `https://innlab.lanzn.com/${fid}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
            },
            body: postData
        });

        console.log(`POST响应长度: ${postResponse.length}`);
        console.log(`POST响应前100字符: ${postResponse.substring(0, 100)}`);

        // 检查响应是否是HTML（意味着挑战处理失败）
        if (postResponse.trim().startsWith('<') || postResponse.includes('acw_sc__v2')) {
            console.log('POST响应仍然是HTML页面，挑战可能未完全处理');
            throw new Error('反爬挑战处理失败，请稍后重试');
        }

        let result;
        try {
            result = JSON.parse(postResponse);
        } catch (parseError) {
            console.error('JSON解析失败，响应内容:', postResponse);
            throw new Error(`服务器返回了非JSON响应: ${parseError.message}`);
        }

        if (result.zt !== 1) {
            throw new Error(result.inf || '文件解析失败');
        }

        // 4. 获取最终URL并缓存
        const intermediateUrl = `${result.dom}/file/${result.url}`;
        console.log(`获取中间URL: ${intermediateUrl}`);

        const finalUrl = await getFinalRedirectUrl(intermediateUrl);
        console.log(`最终URL: ${finalUrl}`);

        // 存入缓存
        await mongoCache.set(fid, finalUrl);
        console.log(`[缓存已更新] fid=${fid}`);

        // 5. 重定向
        res.redirect(302, finalUrl);
    } catch (error) {
        console.error('解析失败:', error);
        res.status(500).send(`解析失败: ${error.message}`);
    }
};

// 改进的挑战处理函数
async function fetchUrlWithChallenge(url, options = {}) {
    let responseText = await fetchUrl(url, options);

    // 检查是否是挑战页面
    if (responseText.includes('acw_sc__v2') && responseText.includes('arg1')) {
        console.log('检测到反爬挑战，正在处理...');

        // 提取arg1
        const arg1 = extractArg1(responseText);
        if (!arg1) {
            throw new Error('无法提取挑战参数arg1');
        }

        console.log('提取到arg1:', arg1);

        // 计算挑战cookie
        const challengeCookie = executeChallenge(arg1);
        if (!challengeCookie) {
            throw new Error('挑战计算失败');
        }

        console.log('生成的cookie:', challengeCookie);

        // 构建完整的cookie头
        const currentCookies = options.headers?.Cookie || '';
        const cookieHeader = currentCookies ?
            `${currentCookies}; ${challengeCookie}` :
            challengeCookie;

        // 使用cookie重新请求
        responseText = await fetchUrl(url, {
            ...options,
            headers: {
                ...options.headers,
                'Cookie': cookieHeader
            }
        });

        // 再次检查是否还是挑战页面
        if (responseText.includes('acw_sc__v2') && responseText.includes('arg1')) {
            console.log('重新请求后仍然是挑战页面');
            throw new Error('挑战处理失败，请刷新页面重试');
        }

        console.log('挑战处理成功');
    }

    return responseText;
}

// 提取arg1值
function extractArg1(htmlText) {
    // 多种方式尝试提取arg1值
    let arg1 = null;

    // 方式1: 原始正则
    const arg1Match1 = /var arg1\s*=\s*'([^']+)'/.exec(htmlText);
    if (arg1Match1) {
        arg1 = arg1Match1[1];
        console.log('方式1匹配成功:', arg1);
        return arg1;
    }

    // 方式2: 更宽松的正则
    const arg1Match2 = /arg1\s*=\s*['"]([A-F0-9]+)['"]/.exec(htmlText);
    if (arg1Match2) {
        arg1 = arg1Match2[1];
        console.log('方式2匹配成功:', arg1);
        return arg1;
    }

    // 方式3: 搜索包含arg1的行
    const lines = htmlText.split('\n');
    for (let line of lines) {
        if (line.includes('arg1') && line.includes('=')) {
            const match = line.match(/['"]([A-F0-9]{40})['"]/);
            if (match) {
                arg1 = match[1];
                console.log('方式3匹配成功:', arg1);
                return arg1;
            }
        }
    }

    console.error('所有匹配方式都失败了');
    return null;
}

// 执行挑战计算
function executeChallenge(arg1) {
    try {
        const posList = [15, 35, 29, 24, 33, 16, 1, 38, 10, 9, 19, 31, 40, 27, 22, 23, 25, 13, 6, 11, 39, 18, 20, 8, 14, 21, 32, 26, 2, 30, 7, 4, 17, 5, 3, 28, 34, 37, 12, 36];
        const mask = "3000176000856006061501533003690027800375";
        const outPutList = [];
        let arg2 = '';
        let arg3 = '';

        // 重新排列
        for (let i = 0; i < arg1.length; i++) {
            const this_i = arg1[i];
            for (let j = 0; j < posList.length; j++) {
                if (posList[j] === i + 1) {
                    outPutList[j] = this_i;
                }
            }
        }

        arg2 = outPutList.join('');

        // 异或运算
        for (let i = 0; i < arg2.length && i < mask.length; i += 2) {
            const strChar = parseInt(arg2.slice(i, i + 2), 16);
            const maskChar = parseInt(mask.slice(i, i + 2), 16);
            let xorChar = (strChar ^ maskChar).toString(16);
            if (xorChar.length === 1) {
                xorChar = '0' + xorChar;
            }
            arg3 += xorChar;
        }

        // 生成cookie（简化版本，不设置domain）
        return `acw_sc__v2=${arg3}`;

    } catch (error) {
        console.error('执行挑战失败:', error);
        return null;
    }
}

// 原有的辅助函数保持不变
function getFinalRedirectUrl(url) {
    return new Promise((resolve, reject) => {
        const { hostname, pathname, search } = new URL(url);

        const req = https.request({
            hostname,
            path: pathname + (search || ''),
            method: 'GET',
            headers: {
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
            }
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

function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const { hostname, pathname, search } = new URL(url);
        const req = https.request({
            hostname,
            path: pathname + (search || ''),
            method: options.method || 'GET',
            headers: {
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
                ...options.headers
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                const buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];

                // 处理压缩内容
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decompressed) => {
                        if (err) {
                            console.log('gzip解压失败:', err.message);
                            resolve(buffer.toString('utf8'));
                        } else {
                            resolve(decompressed.toString('utf8'));
                        }
                    });
                } else {
                    resolve(buffer.toString('utf8'));
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function extractValue(text, regex) {
    const match = regex.exec(text);
    return match ? match[1] : null;
}

function extractAllMatches(text, regex) {
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}
