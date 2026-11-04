# 依存ライブラリのライセンス申告一覧

確認日：2026年11月3日。package-lock.json のインストール対象に記載されたライセンス申告と、インストール済みパッケージ直下の通知ファイルの有無を機械的に整理したものです。法的確認やライセンス本文の確認・同梱が済んだことは意味しません。npm install 後の内容と lockfile を再照合してください。

| パッケージ | バージョン | lockfileの申告 | パッケージ直下の通知ファイル |
| --- | --- | --- | --- |
| @cesium/core | 0.1.0 | Apache-2.0 | LICENSE.md |
| @cesium/engine | 26.4.0 | Apache-2.0 | LICENSE.md |
| @cesium/wasm-splats | 0.1.0-alpha.2 | Apache-2.0 | 直下には見当たらず、確認が必要 |
| @cesium/widgets | 16.3.0 | Apache-2.0 | LICENSE.md |
| @spz-loader/core | 0.3.1 | Apache-2.0 | LICENSE.txt |
| @tweenjs/tween.js | 25.0.0 | MIT | LICENSE |
| @types/trusted-types | 2.0.7 | MIT | LICENSE |
| @zip.js/zip.js | 2.24.0 | BSD-3-Clause | LICENSE |
| autolinker | 4.1.5 | MIT | LICENSE |
| bitmap-sdf | 1.0.4 | MIT | 直下には見当たらず、確認が必要 |
| cesium | 1.146.0 | Apache-2.0 | LICENSE.md |
| commander | 2.20.3 | MIT | LICENSE |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | LICENSE |
| draco3d | 1.5.9 | Apache-2.0 | 直下には見当たらず、確認が必要 |
| earcut | 3.0.2 | ISC | LICENSE |
| grapheme-splitter | 1.0.4 | MIT | LICENSE |
| jsep | 1.6.0 | MIT | LICENSE |
| kdbush | 4.1.0 | ISC | LICENSE |
| ktx-parse | 2.0.0 | MIT | LICENSE |
| lerc | 2.0.0 | Apache-2.0 | 直下には見当たらず、確認が必要 |
| long | 5.3.2 | Apache-2.0 | LICENSE |
| mersenne-twister | 1.1.0 | MIT | 直下には見当たらず、確認が必要 |
| meshoptimizer | 1.3.0 | MIT | LICENSE.md |
| nosleep.js | 0.12.0 | MIT | LICENSE |
| pako | 3.0.3 | (MIT AND Zlib) | LICENSE |
| protobufjs | 8.8.1 | BSD-3-Clause | LICENSE |
| quickselect | 3.0.0 | ISC | LICENSE |
| rbush | 4.0.1 | MIT | LICENSE |
| three | 0.187.0 | MIT | LICENSE |
| topojson-client | 3.1.0 | ISC | LICENSE |
| tslib | 2.9.1 | 0BSD | LICENSE.txt |
| urijs | 1.19.11 | MIT | LICENSE.txt |

表は依存関係の候補を網羅するためのものです。実際に配布・表示されるファイル、組み込み素材・コード、各ライセンスの本文、著作権表示、NOTICE、変更表示、選択可能な条件を個別に確認してください。直下にファイルがない場合もライセンスが存在しないと決めつけず、提供元を確認してください。

## 直下に通知ファイルが見当たらない5件の調査

以下はインストール済みパッケージのメタデータからたどった開発元の現行ページです。開発元の現行ブランチが、インストールされたバージョンと同一であることは未確認です。実際の配布形態に必要な通知を確定したものではありません。

- `@cesium/wasm-splats`：開発元の[ライセンス](https://github.com/CesiumGS/cesium-wasm-utils/blob/main/LICENSE.md)を確認。対象バージョンとの対応と通知を確認する。
- `bitmap-sdf`：[開発元のリポジトリ](https://github.com/dy/bitmap-sdf)にライセンス表示とファイルがある。対象バージョンとの対応を確認する。
- `draco3d`：[開発元のリポジトリ](https://github.com/google/draco)にライセンス表示がある。対象バージョンとの対応を確認する。
- `lerc`：[開発元のリポジトリ](https://github.com/Esri/lerc)にライセンスとNOTICEがある。対象バージョンの通知と適用範囲を確認する。
- `mersenne-twister`：lockfileはMITと申告するが、インストール済みの `node_modules/mersenne-twister/src/mersenne-twister.js` 内には原実装の著作権表示と再配布条件が記載されている。申告だけで処理せず、[開発元のリポジトリ](https://github.com/boo1ean/mersenne-twister)および使用するソースの通知を確認・保持する。

この5件以外も、パッケージ直下に通知ファイルがあることだけでは内部の第三者コードやすべての配布条件の確認になりません。

地図・都市モデル・素材の出典は [ASSET-PROVENANCE.md](ASSET-PROVENANCE.md) を参照。
