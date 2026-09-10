# Agent Note: Plugin RPC Web server resolution

Status: implemented

[English](2026-09-10-plugin-rpc-webserver-resolution.md) | 中文

## 问题

插件注册旧式 Connection RPC 通道时，即使 Web 服务器已运行，也可能因未声明的 `webServer` 访问而失败。Cordis 服务 getter 在依赖检查中保留提供者上下文；调用方声明该服务，并不会将它授予 Connection 提供者。

## 决策

Connection 在注册旧式通道时通过 `ctx.get` 解析可选的 Web 服务器。服务不存在时立即拒绝注册。路由清理函数仍由注册插件持有。无需 Web 服务器的载体中立精确 Fetch 路由与 Remote 拦截器保持可用。

## 考虑过的替代方案

**在每个消费者中注入 Web 服务器。** 属性访问仍由提供者上下文持有，因此无法解决该故障。

**加载 Connection 时要求 Web 服务器。** Headless 与 worker 载体需要在没有 Node HTTP 服务器时使用 Connection。

## 影响

仅在旧式通道需要 Web 服务器时解析这个可选载体。使用 Cordis 服务的测试夹具覆盖注册与移除；完整 Mnemon Web profile 验证登录账号通过部署载体访问 RPC。
