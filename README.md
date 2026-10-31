# MuPDF Viewer for Zed

Zed で編集している文書の PDF を、ブラウザのウィンドウに並べて表示するビューアです。
ファイルが更新されると自動で再読み込みするので、LaTeX や Typst のビルド結果を確認しながら編集できます。
[skrtk98/vscode-pdf-viewer](https://github.com/skrtk98/vscode-pdf-viewer) の VS Code 拡張機能をもとにしています。

## 制限

Zed の拡張 API（2026 年 10 月時点の `zed_extension_api` 0.7.0）には Webview やカスタムエディタがないため、PDF を Zed のタブ内には表示できません。
また、プロジェクトパネルで PDF をクリックしてもこのビューアは起動しません。
起動には Zed のタスクか Agent パネルを使います。

## 機能

- MuPDF/WASM による描画
- マウス位置を中心にしたズーム（`Ctrl+ホイール`、`右ボタン+ホイール`）
- 連続スクロールと単ページ表示の切り替え
- 自動再読み込み
- 目次、サムネイル、ページ番号、PDF 内外のリンク
- 検索、テキストの選択とコピー
- 画像の PNG コピー、ページの回転

## インストール

Node.js と、rustup で導入した Rust が必要です。

```sh
cd viewer
npm ci
npm run build
npm link
```

これで `mupdf-viewer` コマンドが使えるようになります。

## Zed のタスクから開く

`tasks.example.json` の内容を `~/.config/zed/tasks.json` に追加すると、`task: spawn` から次のタスクを実行できます。

| タスク | 開く PDF |
|--------|----------|
| `PDF: open PDF of current file` | 編集中のファイルと同じ名前の PDF（`paper.tex` なら `paper.pdf`） |
| `PDF: open newest PDF in project` | プロジェクト内で更新日時が最も新しい PDF（ドット始まりのディレクトリ、`node_modules`、`target` は除く） |

キーボードショートカットに割り当てるときは、`keymap.json` に次のように書きます。

```json
{
  "context": "Workspace",
  "bindings": {
    "alt-p": ["task::Spawn", { "task_name": "PDF: open PDF of current file" }]
  }
}
```

## コマンドラインから開く

```sh
mupdf-viewer paper.pdf
mupdf-viewer paper.tex --zoom 1.5 --dpi 144
mupdf-viewer . --no-open
```

ビューアのサーバーはバックグラウンドで動きます。
ブラウザとの接続がすべて切れて 30 秒たつと、自動で終了します。
ブラウザが 60 秒以内に接続しなかった場合も終了します。

## SSH 接続先の PDF を開く

Zed の SSH 接続ではタスクがリモート側で動くので、次の準備をします。

1. リモート側で「インストール」の手順を実行します。
2. 手元の Zed の `settings.json` で、ポート 39123〜39127 を転送します。
   Zed は、リモートで開いたポートを自動では転送しないためです。
   ローカル側とリモート側のポート番号は同じにしてください。

   ```json
   {
     "ssh_connections": [
       {
         "host": "接続先",
         "port_forwards": [
           { "local_port": 39123, "remote_port": 39123 },
           { "local_port": 39124, "remote_port": 39124 },
           { "local_port": 39125, "remote_port": 39125 },
           { "local_port": 39126, "remote_port": 39126 },
           { "local_port": 39127, "remote_port": 39127 }
         ]
       }
     ]
   }
   ```

3. `tasks.remote.example.json` の内容をタスクの設定に追加します。

タスクを実行するとターミナルに URL が表示されるので、5 分以内に手元のブラウザで開きます。
同時に開ける PDF は 5 つまでです。

コマンドラインから実行するときは、`SSH_CONNECTION`、`SSH_TTY`、`SSH_CLIENT` のいずれかが設定されていれば SSH 接続と判断し、ブラウザを起動しません。
判定を指定するときは、`--remote` または `--local` を付けます。
`--local` を付けると、接続先のブラウザを開こうとします。

## Agent パネルから開く（拡張機能）

Zed の `zed: extensions` で `Install Dev Extension` を選び、このリポジトリのルートを指定します。
これで `open_pdf` ツールを持つ MCP サーバーが追加され、Agent に PDF を開くよう頼めます。

Zed が `mupdf-viewer` や `node` を見つけられないときは、`settings.json` で絶対パスを指定します。

```json
{
  "context_servers": {
    "mupdf-viewer": {
      "settings": {
        "command": "/absolute/path/to/node",
        "args": ["/absolute/path/to/viewer/dist/cli.js"]
      }
    }
  }
}
```

SSH 接続先の PDF を Agent に開かせるときは、MCP サーバーをリモート側で動かすために `"remote": true` を追加します。
`"remote"` は `context_servers.mupdf-viewer` の直下に書きます。
「SSH 接続先の PDF を開く」のインストールとポート転送も必要です。
Agent が示す URL を手元のブラウザで開いてください。

## セキュリティ

サーバーは `127.0.0.1` だけで待ち受け、起動のたびに生成するトークンを URL に含めます。
指定された 1 つの PDF とビューアのファイル以外は配信しません。
PDF 内のリンクは `http`、`https`、`mailto` だけを開きます。
ただし、URL はブラウザを起動するコマンドの引数として渡すので、同じマシンの他のユーザーからは見える場合があります。
共有マシンで機密の PDF を開くときは注意してください。

## ライセンス

[AGPL-3.0](LICENSE) です。
もとにした VS Code 拡張機能と MuPDF が AGPL-3.0 であるためです。
Zed の公式拡張レジストリの許可ライセンス一覧に AGPL は含まれないので、このリポジトリから導入してください。
