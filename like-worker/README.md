# 点赞计数 Worker(自建指南)

给宠物点赞按钮换上自己的计数服务,数据存在你自己的 Cloudflare D1(SQLite)里,
不再依赖第三方免费 API(Abacus)。全程免费额度:**每天 10 万次写入 / 500 万次读取**,
作品集场景一辈子用不完。

## 一次性准备(约 10 分钟)

1. 注册/登录 [Cloudflare](https://dash.cloudflare.com)(免费计划即可)
2. 本机要有 Node.js,然后:
   ```
   npm install -g wrangler
   wrangler login
   ```
   (会弹浏览器授权)

## 部署四步

在本目录(`like-worker/`)下执行:

```bash
# 1. 建数据库,记下输出里的 database_id
wrangler d1 create koda-likes

# 2. 把 database_id 填进 wrangler.toml 的 database_id = "..." 那一行

# 3. 建计数表(远程执行一次即可)
wrangler d1 execute koda-likes --remote --command "CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"

# 4. 部署,会输出你的专属地址,形如 https://koda-like.你的子域.workers.dev
wrangler deploy
```

## 验证

```bash
curl https://koda-like.你的子域.workers.dev/hit/koda987-site/like
# {"value":1}
curl https://koda-like.你的子域.workers.dev/get/koda987-site/like
# {"value":1}   ← 只读不自增
```

## 接到宠物上

**先试后改**:在站点页面按 F12,控制台里把你的地址临时塞进去,刷新就能用:

```js
localStorage.setItem('koda.pet.likeApi', 'https://koda-like.你的子域.workers.dev')
```

确认点赞正常后,把 `assets/pet/pet.js` 里这一行改成你的地址并推送:

```js
const LIKE_API = 'https://koda-like.你的子域.workers.dev';
```

> 接口形状约定:`/hit/<名字>` 返回 `{value: 数字}`、`/get/<名字>` 同形状只读。
> 自建服务只要对齐这个形状,pet.js 一行都不用改。

## 备注

- 计数接口无鉴权、无防刷(和 Abacus 一样是明牌公开的)。介意虚增的话,
  可以在 Worker 里按 `CF-Connecting-IP` 做简单节流(未来加)
- 数据想清零:`wrangler d1 execute koda-likes --remote --command "DELETE FROM counters"`
- 免费套餐对个人网站完全够用,不会产生账单
