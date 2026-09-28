# 布偶基础套件复用说明

本目录文件复制自 [pet-ragdoll-renderer](https://github.com/ShunyuYao/pet-ragdoll-renderer) 0.2.0（MIT，见 LICENSE）。
唯一修改：`garment-rig.js` 的衣服轮廓允许直接传入已解析的 JSON 对象（HTML 作品的 CSP 禁止 fetch），
以及 import 路径改指 `../lib/`。不含任何头像、照片或衣服贴图；角色素材在运行时由玩家导入。
