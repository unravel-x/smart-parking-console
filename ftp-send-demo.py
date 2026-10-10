#!/usr/bin/env python3
"""FTP 车牌图片发送演示程序

把本地图片(或目录中新增的图片)上传到 FTP 收件目录,由泊序停车系统自动识别。
仅用 Python 标准库,无需安装第三方依赖。

用法:
  python ftp-send-demo.py 图片.jpg                 # 单张上传
  python ftp-send-demo.py 图片目录                 # 监听目录,新增图片自动上传(Ctrl+C 退出)
  python ftp-send-demo.py 图片目录 --once          # 只上传目录中已有的图片,然后退出
  python ftp-send-demo.py 图片.jpg --host 192.168.1.10 --user zx --password 123 --inbox /plates

默认连接参数与项目根目录 .env 保持一致(本机 127.0.0.1),可用命令行参数或环境变量
FTP_HOST/FTP_PORT/FTP_USER/FTP_PASSWORD/FTP_INBOX_DIR 覆盖。
"""

import argparse
import ftplib
import os
import sys
import time
from datetime import datetime
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 21
DEFAULT_USER = "plateuser"
DEFAULT_INBOX = "/"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
MIN_AGE_SECONDS = 2  # 只上传至少 2 秒前写完的文件,防半上传


def timestamp_name(original: str) -> str:
    """生成唯一文件名:日期时间毫秒_原文件名"""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    return f"{stamp}_{original}"


def connect_ftp(host, port, user, password):
    ftp = ftplib.FTP()
    ftp.connect(host, port, timeout=10)
    ftp.login(user, password)
    ftp.set_pasv(True)
    return ftp


def upload_file(ftp, local_path: Path, inbox: str) -> str:
    remote = f"{inbox.rstrip('/')}/{timestamp_name(local_path.name)}"
    with open(local_path, "rb") as fh:
        ftp.storbinary(f"STOR {remote}", fh)
    return remote


def ensure_connected(args):
    """连接 FTP;失败时给出可操作的中文提示并退出"""
    try:
        return connect_ftp(args.host, args.port, args.user, args.password)
    except ftplib.all_errors as error:
        detail = str(error)
        if "timed out" in detail or "refused" in detail or "Name or service" in detail:
            hint = f"无法连接 FTP 服务器 {args.host}:{args.port},请检查地址、端口和网络"
        elif "530" in detail or "Login" in detail or "login" in detail:
            hint = "FTP 登录失败,请检查用户名/密码"
        else:
            hint = f"FTP 连接失败:{detail}"
        print(hint, file=sys.stderr)
        sys.exit(1)


def upload_one(args, path: Path) -> bool:
    """上传单个文件,返回是否成功"""
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        print(f"跳过非图片文件:{path.name}")
        return False
    try:
        ftp = ensure_connected(args)
        try:
            remote = upload_file(ftp, path, args.inbox)
            print(f"已上传:{path.name} -> {remote}")
            return True
        finally:
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()
    except OSError as error:
        print(f"读取本地文件失败:{path} ({error})", file=sys.stderr)
        return False


def watch_folder(args, folder: Path, interval: float = 3.0):
    """监听目录,把新增的图片自动上传;连接断开自动重连"""
    uploaded = set()
    print(f"监听目录:{folder}(每 {interval:.1f} 秒检查一次,Ctrl+C 退出)")
    ftp = None
    while True:
        try:
            if ftp is None:
                ftp = connect_ftp(args.host, args.port, args.user, args.password)
                print("FTP 已连接")
            for path in sorted(folder.iterdir()):
                if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                key = (path.name, path.stat().st_size)
                if key in uploaded:
                    continue
                if time.time() - path.stat().st_mtime < MIN_AGE_SECONDS:
                    continue  # 可能还在写入,下轮再查
                remote = upload_file(ftp, path, args.inbox)
                uploaded.add(key)
                print(f"已上传:{path.name} -> {remote}")
        except KeyboardInterrupt:
            print("\n已停止监听")
            break
        except ftplib.all_errors as error:
            print(f"FTP 连接异常,{interval:.1f} 秒后重连:{error}", file=sys.stderr)
            ftp = None
        except OSError as error:
            print(f"本地读取失败:{error}", file=sys.stderr)
        time.sleep(interval)
    if ftp is not None:
        try:
            ftp.quit()
        except ftplib.all_errors:
            ftp.close()


def main():
    parser = argparse.ArgumentParser(description="FTP 车牌图片发送演示程序")
    parser.add_argument("target", help="图片文件路径,或要监听的图片目录")
    parser.add_argument("--host", default=os.environ.get("FTP_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FTP_PORT", DEFAULT_PORT)))
    parser.add_argument("--user", default=os.environ.get("FTP_USER", DEFAULT_USER))
    parser.add_argument("--password", default=os.environ.get("FTP_PASSWORD"))
    parser.add_argument("--inbox", default=os.environ.get("FTP_INBOX_DIR", DEFAULT_INBOX))
    parser.add_argument("--interval", type=float, default=3.0, help="监听目录的检查间隔秒数(默认 3)")
    parser.add_argument("--once", action="store_true", help="目录模式下只上传已有图片,不持续监听")
    args = parser.parse_args()
    if not args.password:
        print("缺少密码:请通过 --password 参数或环境变量 FTP_PASSWORD 提供", file=sys.stderr)
        sys.exit(1)

    target = Path(args.target)
    if target.is_file():
        ok = upload_one(args, target)
        sys.exit(0 if ok else 1)
    if target.is_dir():
        if args.once:
            for path in sorted(target.iterdir()):
                if path.is_file():
                    upload_one(args, path)
            return
        watch_folder(args, target, interval=args.interval)
        return
    print(f"找不到文件或目录:{args.target}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
