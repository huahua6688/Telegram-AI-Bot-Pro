# 常用命令说明

## 启动

    npm start

## 配置检查

    npm run doctor

## 快速验证

    npm run verify

会运行：

    npm run check:secrets
    npm run check:syntax
    npm run test:quick

## Docker 验证

    npm run docker:verify

会构建 Docker 镜像，并在镜像内运行 doctor。

## 部署前检查

    npm run predeploy

部署 Zeabur 前推荐运行。
