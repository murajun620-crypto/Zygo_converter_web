# Zygo Surface Lab

Zygo MetroPro バイナリーDAT（format 1–3）をブラウザー内で解析するWebアプリです。

## 使い方

DATを画面にドラッグ＆ドロップします。複数の測定を同じ条件で解析・比較できます。
測定ファイルをサーバーへ送信する処理はありません。外部CDN・外部解析APIも使用しません。
読み込んだデータはブラウザーを閉じると消えるため、必要な結果は保存してください。

- 2D / 3Dマップ、カラーマップ切替、X / Y / 任意断面の比較
- 平面・曲面補正、FFT空間フィルター、カットオフ指定
- 標準片側PSD、2D FFT、X / Y PSD、放射平均、累積 / 帯域RMS
- 2D FFTの中心拡大・任意周波数範囲、等波長の円、カーソル／数値位置での波長・方向読み取り
- Sq / Sa / PV、高さ分布・Ssk / Sku、方向性
- PNG・XLSX・CSV・解析条件JSON・一括ZIP保存
- 各「？」には、合成表面を実際に計算した図付きの説明と切替可能な例があります

PSDは初期設定で平面補正のみ・フィルターなし・クリップなしの表面を使用し、空間波長で表示します。
2D FFTは周波数軸を保ち、波長を `1 / sqrt(fx² + fy²)` で読み取ります。中心拡大は表示だけで、周波数分解能は増えません。色範囲は初期設定で全域に共通、手動指定も可能です。PNGには現在の範囲・円・色範囲・分解能を記載し、CSVは全域の対数化前の数値を保存します。
XLSXの先頭「Plot Data」シートは、[PlotLauncher Web](https://murajun620-crypto.github.io/plot_launcher_web/)でXY列を選択して描画できます。
MetroProの機能構成を参考にした独立実装です。球面・円筒は浅い形状の2次近似です。

## 公開内容

この公開リポジトリにはアプリの静的ファイルと配置設定だけを置きます。
測定DAT・測定結果・既存の資料・元Python・非公開リポジトリの履歴は含めません。
説明用の表面はJavaScriptで生成した合成データです。

## GitHub Pages

Settings → Pages → Build and deployment → Sourceで **GitHub Actions** を選びます。
`main`への更新で、`.github/workflows/pages.yml`が`site/`だけを公開します。
公開前にファイル名と種類を検証し、想定外のファイルがある場合は配置を止めます。
GitHub Pagesのサイト本体は一般公開です。DATは各利用者のブラウザー内で処理します。

ローカル確認にはHTTPサーバーで`site/`を配信してください（例：`python -m http.server 8000 --directory site`）。
