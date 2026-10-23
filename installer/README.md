# 安装包

`4DGen.iss` 是 Inno Setup 6 脚本，安装包按当前用户安装到 `%LOCALAPPDATA%\Programs\4DGen`，不需要管理员权限。

构建：

```sh
npm run desktop:package
npm run desktop:installer
```

需要 Inno Setup 6，`ISCC.exe` 在 PATH 中或通过 `ISCC` 环境变量指定。

`ChineseSimplified.isl` 来自 [kira-96/Inno-Setup-Chinese-Simplified-Translation](https://github.com/kira-96/Inno-Setup-Chinese-Simplified-Translation)，MIT 许可，适配 Inno Setup 6.5.0+。
