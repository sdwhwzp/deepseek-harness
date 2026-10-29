---
kind: upgrade-guide
description: "账号部署需要独立附件授权，且不能使用原始文件路由。"
---

# 账号附件访问

[English](guide.md) | 中文

## 变更

认证附件读取与 ZIP 导出需要独立账号授权。Session 可读或历史中出现引用均不足以授权。浏览器 Session 与 subagent 提示词拒绝持久引用，并在投递前记录已验证上传的归属。未实现附件支持的提供方会拒绝这些操作。Markdown 导出在读取内容或元数据前检查确切 Session。

只要存在账号 principal、请求认证提供方或 principal-access 提供方，`GET|HEAD /api/file` 就返回 403，不执行路径解析、元数据读取、重定向或内容读取。本地匿名文件展示保留原有行为。此前缓存的文件响应可能仍留在浏览器缓存中；服务器拒绝访问无法撤回已交付字节。

## 迁移

1. 一起升级所有 Host、CLI、SDK、Web 读写方。部署提供方必须将 `subjects.attachmentIds` 解析为 `readableAttachmentIds`，并实现 `recordAttachments(principal, { sessionId, attachmentIds }, signal)`。重新验证有效账号与当前 Session 归属，持久化幂等授权后才返回。
2. 将账号授权与 Session 文件、附件对象一起快照。旧附件访问只从可信且经操作员审核的归属证据恢复；绝不单凭 Session 历史推断归属。未知归属保持拒绝，或要求重新上传字节。不需要重写附件字节或 Session 格式。
3. 将认证原始路径文件展示替换为独立鉴权的端点。Session 附件读取使用完整图片引用及其账号授权。清除共享浏览器配置中此前缓存的原始文件响应。
4. 验证自己的已授权旧附件、新上传、跨账号引用提示词拒绝、跨账号附件及导出拒绝，以及 GET/HEAD 原始文件拒绝。验证不完整认证组合默认拒绝、本地匿名操作仍然可用。
