/**
 * 测试入口：注册 cloudflare:workers 拦截器。
 * 用法：node --import ./tests/helpers/register-cloudflare.mjs --test tests/
 */
import { register } from "node:module";

register(new URL("./cloudflare-hooks.mjs", import.meta.url));
