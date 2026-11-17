# 点赞计数 Worker(自建指南)

给宠物点赞按钮换上自己的计数服务,数据存在你自己的 Cloudflare D1(SQLite)里,
不再依赖第三方免费 API(Abacus)。全程免费额度:**每天 10 万次写入 / 500 万次读取**,
作品集场景一辈子用不完。

两条路线任选:**网页面板(全程点鼠标)** 或 命令行(见文末)。

---

## 路线 A:纯网页版(零命令,约 10 分钟)

### 1. 注册 + 建 Worker

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com) 注册/登录(免费计划即可)
2. 左侧 **Workers & Pages** → **Create** → 选 **Worker** → 起名 `koda-like` → **Deploy**
3. 部署完点 **Edit code(编辑代码)**:把编辑器里默认代码**全删掉**,
   换成 [like-worker/src/index.js](./src/index.js) 的全部内容
   (也可以打开 [GitHub 上的这份文件](https://github.com/Koda987/Koda987.github.io/blob/main/like-worker/src/index.js) 全选复制)
   → 右上 **Deploy** 保存

### 2. 建数据库 + 建表

1. 左侧 **Storage & Databases → D1 SQL Database** → **Create Database** → 名字填 `koda-likes` → 创建
2. 进这个数据库的页面,选 **Console(控制台)** 标签,粘贴下面这句 → **Run**:
   ```sql
   CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)
   ```

### 3. 把数据库接到 Worker 上

1. 回到 **Workers & Pages** → 点开 `koda-like` → **Settings(设置)→ Bindings(绑定)→ Add**
2. 类型选 **D1 Database**:变量名填 **`DB`**(必须一字不差,代码里用的就是它),
   D1 database 选刚建的 `koda-likes` → **Deploy** 保存

### 4. 验证

浏览器直接打开:

```
https://koda-like.你的子域.workers.dev/hit/koda987-site/like
```

看到 `{"value":1}` 就是通了(再开一次会变 2,那是自增,正常)。

### 5. 接到宠物上

**先试后改**:在作品集页面按 F12,控制台里执行(把地址换成你的):

```js
localStorage.setItem('koda.pet.likeApi', 'https://koda-like.你的子域.workers.dev')
```

刷新页面点个赞,确认走的是你的服务。满意后把 `assets/pet/pet.js` 里这一行
改成你的地址、推送一次,永久切换完成:

```js
const LIKE_API = 'https://koda-like.你的子域.workers.dev';
```

> 接口形状约定:`/hit/<名字>` 返回 `{value: 数字}`、`/get/<名字>` 同形状只读。
> 自建服务只要对齐这个形状,pet.js 一行都不用改。

---

## 路线 B:命令行版(程序员习惯,可脚本化)

前提:装好 Node.js,然后 `npm install -g wrangler` + `wrangler login`(弹浏览器授权)。
在 `like-worker/` 目录下:

```bash
wrangler d1 create koda-likes        # 1. 建库,记下输出的 database_id
# 2. 把 database_id 填进 wrangler.toml
wrangler d1 execute koda-likes --remote --command "CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"   # 3. 建表
wrangler deploy                      # 4. 部署,得到你的 workers.dev 地址
```

## 备注

- 计数接口无鉴权、无防刷(和 Abacus 一样是明牌公开的)。介意虚增的话,
  可以在 Worker 里按 `CF-Connecting-IP` 做简单节流(未来加)
- 数据想清零:D1 数据库页面 Console 里跑 `DELETE FROM counters`
- 免费套餐对个人网站完全够用,不会产生账单
