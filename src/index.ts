import cors from "@koa/cors"
import Router from "@koa/router"
import childProcess from "child_process"
import validator from "email-validator"
import fs from "fs/promises"
import fetch from "isomorphic-fetch"
import Koa, { Context } from "koa"
import bodyParser from "koa-bodyparser"
import rateLimit from "koa-ratelimit"
import { Record, String } from "runtypes"
import tempy from "tempy"
import util from "util"
const exec = util.promisify(childProcess.exec)
const db = new Map()

const PostBody = Record({
  email: String,
  token: String,
})

const router = new Router()
  .get("/", async (ctx: Context) => {
    const count = parseInt((await exec("sudo list_members subscribers | wc -l")).stdout.trim())
    ctx.body = { count }
  })
  .post("/", async (ctx: Context) => {
    const { email, token } = PostBody.check(ctx.request.body)
    ctx.assert(validator.validate(email), 400)
    try {
      const url = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.GOOGLE_RECAPTCHA_SECRET_KEY}&response=${token}`
      const response = await fetch(url, { method: "POST" }).then((r) => r.json())
      const { success, score } = response
      await fs.appendFile("requests.txt", JSON.stringify({ ...response, email }, null, 2) + "\n")
      if (success && score > 0.5) {
        tempy.temporaryFileTask(
          async (tempPath) => {
            await fs.writeFile(tempPath, email)
            await exec(`sudo /usr/lib/mailman/bin/subscribe_members -r ${tempPath} subscribers`)
          },
          { extension: "txt" },
        )
      }
    } catch (err) {
      console.error(err)
      ctx.throw(400)
    }
    ctx.body = ""
  })

new Koa({ proxy: true })
  .use(cors())
  .use(
    rateLimit({
      driver: "memory",
      db: db,
      duration: 1000 * 60 * 60,
      headers: {
        remaining: "Rate-Limit-Remaining",
        reset: "Rate-Limit-Reset",
        total: "Rate-Limit-Total",
      },
      max: 1,
      whitelist: (ctx) => ctx.request.method === "GET",
    }),
  )
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(3000)
