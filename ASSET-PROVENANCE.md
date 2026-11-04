# データ・素材の出典と公開前の確認

確認日：2026年11月3日。これは出典の整理と残作業の記録であり、公開可否を確定する法的判断ではありません。実際に使う地域・素材・公開方法を確定した後、各提供元の最新条件を確認してください。

| 対象 | 作品での使い方 | 出典・確認先 | 公開前に残ること |
| --- | --- | --- | --- |
| 国土地理院の地理院タイル | 実地図の背景、航空写真 | [地理院地図の利用](https://maps.gsi.go.jp/help/use.html)、[タイル一覧](https://maps.gsi.go.jp/development/ichiran.html) | 選択したタイルの条件と、画面・デモ動画中の出典を確認する。 |
| 国土交通省 PLATEAU | 実地図上の3D都市モデル | [サイトポリシー](https://www.mlit.go.jp/plateau/site-policy/)、[3D Tiles配信](https://docs.plateauview.mlit.go.jp/datasets/3d-tiles/) | 実際に取得する地域・データセットの権利表示、改変の有無、配信元の条件を確認する。データによって条件が異なり得る。 |
| 洪水浸水想定区域 | 未来の洪水を想定した区域の重ね合わせ | [ハザードマップポータルの公開データ](https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html) | 使用レイヤーの範囲と欠落を確認し、現在の浸水範囲として表現しない。出典と加工の有無も示す。 |
| 施設データ | 配送先候補 | [ハザードマップポータルのデータ出典](https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/copyright_data.html) | 使用する施設データの提供元、更新日、対象範囲を確認する。掲載は現在の開設・受入を保証しない。 |
| 気象庁のデータ | 取得できる場合の降水情報 | [気象庁の利用規約](https://www.jma.go.jp/jma/kishou/info/coment.html) | 使用したデータと加工の有無を表示し、取得時刻・欠測を確認する。 |
| Poly Haven | `plaster.jpg`、`asphalt.jpg`、`overcast.hdr`、`assets/urban/` のモデル類 | [Poly Haven のライセンス](https://polyhaven.com/license) | 個別ファイルとダウンロード元の対応を再確認する。通常の素材は CC0 と案内されている。 |
| 導入画面の背景 | `assets/mission-intro-generated-20261104.png` | 2026年11月4日にOpenAIの画像生成で新規作成した架空都市 | 実際の災害写真ではない。旧画像は残すが公開候補には含めない。 |
| amvlab | `assets/rescue-drone.glb`、100機表示の代表機 | [aircraft-models](https://github.com/amvlab/aircraft-models) / [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | ロゴなし版 `drone_nologo.glb` を無改変で利用。地図の出典欄にも作者・ライセンスを表示。旧サーバーでは同じモデルをGitHubから取得する。 |
| CesiumJS / Three.js | 3D地図・仮想都市の描画 | [CesiumJS](https://github.com/CesiumGS/cesium)、[Three.js](https://github.com/mrdoob/three.js) | 依存パッケージ全体のライセンスと必要な通知を確認する。 |

地図画面には地理院タイル、PLATEAU、ハザードマップの出典を表示し、降水データを重ねる場合は気象庁の出典も表示する設定です。画面や動画で隠れず読めるかは、実際に使う画面サイズと表示状態で確認してください。地図画像をMuseに渡す際に使う画像が画面上の出典表示を含むとは限りません。利用条件と必要な出典の扱いは別途確認が必要です。

依存ライブラリについては、lockfileのライセンス申告とインストール済みパッケージ直下の通知ファイルの有無を [THIRD-PARTY-INVENTORY.md](THIRD-PARTY-INVENTORY.md) に一覧化しました。申告の一覧であり、ライセンス本文や配布条件の確認完了ではありません。

CesiumJSの初期設定では地理院タイルと楕円体地形を明示しています。画面に Cesium ion のロゴが出ることだけでは、ion のデータを使ったかは判断できません。実際に読み込まれる都市モデル配信先や子データも含めて確認し、ionのサービスやデータを使う場合は、その利用形態と[利用規約](https://cesium.com/legal/terms-of-service)を確認してください。特に地図画像のAIへの送信は利用元ごとの条件確認が未完了です。

`assets/concrete.jpg` は使用箇所と出典が未確認、`assets/reference/` と `drone-concept-reference.png` は参考画像の出典・公開条件が未確認です。削除はせず、確認が終わるまで `.gitignore` で公開用の追加対象から外しています。公開前にはAPIキー、ローカル設定、録音、履歴、検証画面なども改めて点検してください。`.gitignore` は既に追跡されたファイルを自動的に取り除く仕組みではありません。

2026年11月3日、作品フォルダーのテキストを対象にMetaキーに似た一種類のパターンを検索し、該当ファイルはありませんでした。依存フォルダー、検証資料、ローカルメモ、画像や3Dバイナリなどは対象外です。ほかの形式の秘密情報や公開候補全体の安全性は確認できていないため、公開前には実際の公開対象を改めて点検してください。
