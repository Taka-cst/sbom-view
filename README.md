# sbom-lens

CycloneDX / SPDX (JSON) に対応した SBOM ビューア。
コンポーネント一覧をテーブルで確認しつつ、依存関係をインタラクティブなグラフで可視化できる。

## 機能

- CycloneDX / SPDX 両フォーマットの自動判定・パース
- コンポーネントの検索・フィルタ・ソート付きテーブル表示
- D3.js によるフォースグラフで依存関係を可視化
  - ノードのドラッグ・ズーム・パン操作
  - ノードクリックで子孫の折りたたみ / 展開
  - ホバーで親ノード・子ノード数などの詳細表示
- ローカルファイルのドラッグ＆ドロップ / ファイル選択
- URL を指定してリモートの SBOM ファイルを直接取得・解析
  - 取得前に SBOM フォーマットのバリデーションあり
  - 解析後に一時ファイルを即削除

## 起動方法

Docker Compose で立ち上げる。

```bash
docker compose up --build -d
```

http://localhost:5001 でアクセスできる。

### Docker を使わない場合

```bash
pip install -r requirements.txt
python app.py
```

http://localhost:5000 でアクセスできる。

## 使い方

1. ブラウザでアクセスし、SBOM の JSON ファイルをドラッグ＆ドロップ、ファイル選択、または URL 入力でアップロード
2. 「テーブル表示」タブでコンポーネント一覧を確認
3. 「依存関係ツリー」タブでグラフを確認
   - ノードをクリックすると子孫を折りたためる（他の親から参照されているノードは残る）
   - 「すべてのノードを表示」ボタンで一括復元

## サンプルデータ

`samples/` ディレクトリに CycloneDX と SPDX のサンプルファイルがある。動作確認に使える。

## 構成

```
.
├── app.py                 # Flask アプリ本体
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── templates/
│   └── index.html
├── static/
│   ├── app.js             # フロントエンド (D3.js グラフ含む)
│   └── style.css
└── samples/
    ├── sample-cyclonedx.json
    └── sample-spdx.json
```

## 技術スタック

- Python 3.12 / Flask / Gunicorn
- D3.js v7
- Docker

## ライセンス

MIT
