const validator = require('email-validator')
const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')
const Router = require('@koa/router')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const ratelimit = require('koa-ratelimit')
const db = new Map()
const fetch = require('isomorphic-fetch')
const tempy = import('tempy')
const fs = require('fs').promises

const router = new Router()

router
  .get("/", async ctx => {
    const count = parseInt((await exec("sudo list_members subscribers | wc -l")).stdout.trim())
    ctx.body = { count }
  })
  .post("/", async ctx => {
    const { email, token } = ctx.request.body
    ctx.assert(validator.validate(email), 400)
		try {
			const url = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.GOOGLE_RECAPTCHA_SECRET_KEY}&response=${token}`
			const response = await fetch(url, { method: "POST" }).then(r => r.json())
			const { success, score } = response
			await fs.appendFile("requests.txt", JSON.stringify({ ...response, email }, null, 2) + "\n")
			if (success && score > 0.5) {
				tempy.file.task(async (tempPath) => {
					await fs.writeFile(tempPath, email)	
					const output = await exec(`sudo /usr/lib/mailman/bin/subscribe_members -r ${tempPath} subscribers`)
				}, { extension: "txt" })	
			}
		} catch (err) {
			console.error(err)
			ctx.throw(400)
		}
    ctx.body = ''
  })

const app = new Koa({ proxy: true })
  .use(cors())
	.use(ratelimit({
		driver: 'memory',
		db: db,
		duration: 1000 * 60 * 60,
		headers: {
			remaining: 'Rate-Limit-Remaining',
			reset: 'Rate-Limit-Reset',
			total: 'Rate-Limit-Total'
		},
		max: 1,
		whitelist: (ctx) => ctx.request.method === 'GET'
	}))
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(3000)
