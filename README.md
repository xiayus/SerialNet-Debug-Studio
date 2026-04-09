# SerialNet Debug Studio

<p align="center">
  <img src="images/logo.png" alt="SerialNet Debug Studio logo" width="180">
</p>

**[English README →](README.en.md)**

本地运行的网页调试工具：浏览器负责界面与实时曲线，**FastAPI** 后端负责串口 / TCP / UDP 与设备通信；前后端通过 **WebSocket** 推送日志与解析数据，无需数据库与登录。

**SerialNet Debug Studio** 是一个面向**嵌入式开发**与设备联调的**串口调试工具 / TCP 调试工具 / UDP 调试工具**：支持 **Serial Monitor** 风格日志查看、**Serial Plotter** 风格多通道曲线、HEX 发送、行尾控制、校验计算与本地网页界面，适合用作 **Arduino Serial Monitor / Serial Plotter** 的增强型替代方案之一。

## 适用场景

- **串口调试工具**：用于 COM / UART 设备日志查看与发送测试
- **TCP 调试工具**：用于本地 TCP Client 联调、网络设备调试
- **UDP 调试工具**：用于 UDP 收发测试与本地监听
- **串口绘图仪 / Serial Plotter**：用于传感器、ADC、温湿度等数据实时曲线显示
- **嵌入式调试工具**：适合 Arduino、ESP32、STM32、单片机、传感器网关等场景
- **本地 Web 调试台**：浏览器界面 + Python 后端，无需云服务、无需数据库、无需登录

## 如果你正在找

- 一个支持 **Serial / TCP / UDP** 的本地调试工具
- 一个带 **HEX 发送、校验算法、行尾控制** 的协议调试面板
- 一个可替代 **Arduino 串口监视器** 的网页工具
- 一个可替代基础 **Serial Plotter** 的多通道曲线调试工具
- 一个适用于**嵌入式设备联调**的轻量本地 dashboard

那么这个项目可能适合你的工作流。


## 开发初衷


日常做嵌入式调试时，**Arduino IDE** 自带的串口监视器大多仍以 **USB / 蓝牙** 等链路为主，对这种栈上的 **Wi‑Fi（TCP/UDP）** 设备不够友好；上行显示较密、难分 channel，下行也不容易按协议**自由组帧**（校验、行尾、十六进制等）。其 **串口绘图仪** 能画几条线，但协议与交互都偏简单。

另一条常见选型是 **Serial Studio Pro** 一类工具：功能全，但体量重；若只想做**轻量网络透传与日志/曲线**，连简单网络能力也可能要付费。

因此做了 **SerialNet Debug Studio**：**在同一套网页里**把串口、TCP、UDP 收齐，日志与 **ECharts** 多通道曲线读得清楚，发送端可按需组包，栈留在本机、无需账号与云依赖，用来填补「IDE 偏轻、重工具偏重」之间的空白，方便嵌入式联调。

## 与常见工具的区别

- 相比 **Arduino Serial Monitor**：除串口外，还支持 **TCP / UDP**。
- 相比 **Arduino Serial Plotter**：支持**命名通道**、多通道曲线、协议化发送与更清晰的日志面板。
- 相比偏重型桌面调试工具：更强调**本地优先、轻量、打开浏览器即可使用**。
- 相比只做网络收发的小工具：额外提供**曲线可视化、发送历史、校验与国际化界面**。

## 界面与架构预览

### 架构图

下图展示了项目的整体结构：左侧是 **Serial / TCP / UDP** 设备连接，中间是 **FastAPI** 后端、连接管理、数据解析与 **WebSocket** 推送，右侧是浏览器端的连接面板、日志面板、曲线面板与发送面板。

![SerialNet Debug Studio 架构图：本地运行的串口 TCP UDP 调试工具，包含 FastAPI 后端、WebSocket 和浏览器前端](images/Architecture%20diagram.png)

### 运行界面截图

下表汇总了几个典型界面场景。

| 串口连接与实时曲线 | TCP 调试界面 |
|---|---|
| 串口模式下，左侧显示实时日志，右侧显示按通道动态生成的多通道曲线，适合传感器、ADC、状态量等嵌入式数据联调。<br><br>![串口调试工具界面截图：Serial COM 连接、实时日志与多通道曲线](images/串口连接运行截图.png) | TCP Client 模式下可直接连接目标主机与端口，在同一界面查看日志、发送指令并观察实时图表。<br><br>![TCP 调试工具界面截图：TCP client 连接、实时日志和图表](images/TCP接口链接运行截图.png) |

| 图表自由框选 | 命令历史 |
|---|---|
| 曲线面板支持自由框选局部时间范围，便于观察一段波形区间内的细节变化。<br><br>![Serial Plotter 风格图表截图：支持框选缩放查看局部波形](images/自由框选图表功能截图.png) | 发送区支持历史命令快速回填，方便重复发送常用调试指令，提高联调效率。<br><br>![命令历史截图：快速回填常用发送指令](images/命令历史记录截图.png) |


## 功能概览


| 模块 | 说明 |
|------|------|
| 通信 | **Serial（COM）** / **TCP Client** / **UDP**（可发、可选本地监听），同一时刻仅一种活动连接 |
| 日志 | 时间戳经前端统一格式（UTC ISO，与 `SYS` 一致），`[RX]` / `[TX]` / `[SYS]` / `[ERR]`，自动滚动；**行数上限**见下文常量 |
| 曲线 | **ECharts** 多通道折线；采样点上限见下文；通道随解析数据**动态出现**（类 Arduino 串口绘图仪）；X 轴时间可按本地 **时:分:秒.毫秒** 展示；支持暂停/继续、缩放重置、CSV 复制与导出 |
| 发送 | **文本 / 十六进制**输入模式；**行尾**（无 / LF / CR / CRLF）；多种 **校验算法**（XOR-8、CRC 族、MOD-256、Adler-32、Fletcher-16 等），校验仅针对正文，字节插在正文与行尾之间；**TX 回显**可勾选（成功后可选写 `[TX]` 日志）；**Enter** 发送；发送历史 **↑ / ↓** 与弹层列表、**清空历史**（仅本地存储）；未连接时发送区与格式行控件禁用 |
| 国际化 | **8 种界面语言**（zh / en / ja / ko / de / fr / es / pt-BR），见 `static/i18n.js` |
| TCP | **Host/Port** 本地记忆；**最近 3 条**成功连接以胶囊一键填入 |
| 链路状态 | WebSocket 与定时 **GET `/api/status`** 双通道对齐连接态，避免仅断 WS 时 UI 仍显示已连 |

## 开发路线图

当前仓库的已实现能力仍以 **Serial（COM）/ TCP / UDP** 为准。

### 已支持

- **Serial（COM）**：本地串口连接、日志查看、发送与解析
- **TCP Client**：设备联调、日志查看、发送与实时图表
- **UDP**：发送、可选本地监听、日志与数据解析
- **统一前端体验**：日志、曲线、发送历史、HEX、行尾、校验算法、多语言界面

### 计划中

- **MQTT**：连接 Broker、发布 / 订阅 Topic、查看消息日志，并将数值型消息接入实时曲线
- **蓝牙（BLE 优先）**：优先考虑 **Bluetooth Low Energy（BLE）**，后续再评估经典蓝牙串口类场景
- **更多协议适配层**：在现有 TCP / UDP 之外扩展更适合设备消息通信的连接方式
- **统一连接抽象持续完善**：让更多协议复用相同的日志、发送、历史、校验、解析与图表能力

### 想法池

- **协议插件化**：为未来新增协议保留更清晰的扩展入口
- **更多图表类型**：除当前折线图外，探索柱状图、面积图、仪表盘、状态卡片等更适合不同数据场景的可视化方式
- **图表能力扩展**：为不同协议或数据模型提供更灵活的系列映射、图表配置、字段分组与多面板展示能力
- **自定义 JS 解析脚本**：允许通过自定义 JavaScript 脚本解析不同设备协议，将原始报文转换为结构化字段、日志文本或图表数据
- **脚本化协议适配**：为用户脚本约定统一输入输出接口，使不同设备协议可以通过脚本快速接入，而不必每次都改动后端内置解析器
- **更多设备调试工作流**：例如更细粒度的会话面板、消息模板、协议预设
- **跨协议一致性增强**：尽量让 Serial、TCP、UDP、MQTT、蓝牙等协议共享相似的操作体验

> 说明：`计划中` 与 `想法池` 仅代表当前 roadmap，不代表这些功能已经在仓库中实现。


## 技术栈


- Python **3.10+**（建议 3.11+）
- **FastAPI** + **Uvicorn**
- **WebSocket**（Starlette）
- **pyserial**（串口枚举与读写）
- 前端：**原生 HTML / CSS / JavaScript**，图表 **Apache ECharts**（CDN），国际化模块 **`static/i18n.js`** + **`static/app.js`**


## 项目结构


```
SerialNet-Debug-Studio/
├── app.py                 # Uvicorn 入口：将 `src` 加入 path 并暴露 `app`
├── src/
│   └── serialnet_debug_studio/   # Python 包（应用代码）
│       ├── app.py               # FastAPI：REST、WebSocket、静态资源挂载（读仓库根目录 `static/`）
│       ├── connection_manager.py
│       ├── parser.py            # 逗号分隔 key=value / key:value → 数值（曲线）
│       └── transports/
│           ├── base_transport.py
│           ├── serial_transport.py
│           ├── tcp_transport.py
│           └── udp_transport.py
├── static/                # 前端静态资源（与包代码分离）
│   ├── index.html
│   ├── i18n.js
│   ├── app.js
│   └── style.css
├── images/                # README 使用的 logo、架构图与界面截图
│   ├── logo.png
│   ├── Architecture diagram.png
│   └── ...
├── scripts/               # 本地联调用可执行脚本（非 pytest）
│   ├── tcp_test_server.py
│   ├── udp_sender.py
│   └── serial_mock.py
├── requirements.txt
├── LICENSE
├── NOTICE
├── README.md
└── README.en.md
```


## 快速开始


```bash
cd SerialNet-Debug-Studio
python -m pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
# 等价：uvicorn serialnet_debug_studio.app:app --app-dir src --host 127.0.0.1 --port 8000
```


浏览器打开：**http://127.0.0.1:8000/**


页面加载后会自动连接 **`/ws`**。


## 默认配置（与页面初始值大致一致）


| 项 | 默认值 |
|----|--------|
| 通信方式 | TCP（未连接时可用 `localStorage` 恢复上次所选） |
| TCP 地址 | `192.168.1.100:5000` |
| Serial | 115200，8N1，读超时 0.2 s |
| UDP Remote | `192.168.1.100:5001`；本地监听端口示例 `5001` |
| 行尾 | **LF** |


## HTTP API


| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ports` | 串口列表 `{ "ports": ["COM3", ...] }` |
| POST | `/api/connect` | JSON：`mode` 为 `serial` / `tcp` / `udp`，并携带对应配置对象（字段名与前端 `buildConnectBody` 一致，如 `serial.port`、`tcp.host` 等） |
| POST | `/api/disconnect` | 断开当前连接 |
| POST | `/api/send` | 两种负载二选一：① **`{ "bytes_b64": "<Base64>" }`** — 按**原始字节**发出，**不**自动补换行，也**不**经 WebSocket 再打一条服务端 `TX` 日志（适合与页面「高级发送」一致）；② **`{ "text": "..." }`**（或 `line`）— UTF-8 编码发送，若字符串末尾**没有** `\n`，后端会**自动追加 `\n`**，并在 WS 上发布 `TX` 日志 |
| GET | `/api/status` | `{ "state", "mode", "detail" }`，`state`：`disconnected` \| `connecting` \| `connected` \| `error` |


## WebSocket `/ws`


服务端推送 JSON：


| type | 说明 |
|------|------|
| `status` | 与 `/api/status` 相同字段，连接状态变化时更新 |
| `log` | `channel`（如 `RX` / `TX` / `SYS` / `ERR`）、`message`、`ts`（UTC ISO，前端显示时与本地 SYS 行统一格式化） |
| `parsed_data` | `values`：数值字典，`raw_line`：原始行（解析失败或无非数字字段时可能不上送） |


客户端可发送任意文本保活（服务端读入后丢弃）。


## 接收与曲线数据协议（行文本）


### 分帧与编码

- 接收缓冲区按字节累积，以 **LF（`\n`）** 分帧；`\n` 之前的一帧 UTF-8 解码（非法字节替换），再对字符串尾部执行与后端相同的 **`rstrip('\r\n')`**，因此设备可发 **CRLF** 或仅 **LF** 结尾。
- 每帧整行交给 `src/serialnet_debug_studio/parser.py`；**纯数字、无 `=` / `:` 的片段不会被当成通道**（与「Arduino 串口绘图仪」仅 CSV 数字的格式不同）。

### 单行内可解析格式（进入曲线的部分）

- 多个字段用英文逗号 **`,`** 分隔；每个字段必须是 **`键=值`** 或 **`键:值`**（每段内只按**第一个** `=` 或 `:` 拆开键与值）。
- **键**：去掉首尾空白后非空；作为曲线中的**通道名 / 图例**（区分大小写）。
- **值**：去掉首尾空白后须能解析为数字，规则与上述 `parser.py` 一致：
  - 若含 **`.`** 或 **`e` / `E`**（科学计数法），按浮点数；
  - 否则若形如 **`±0x…`**，按十六进制整数；
  - 否则按十进制整数；
  - 仍失败时再尝试一次浮点解析。
- 畸形段跳过；**若本行没有任何合法数值键值对**，不通过 WebSocket 上送 `parsed_data`（曲线不增加采样点），但该行仍以 **`[RX]`** 写入日志。

### 图表侧行为（`parsed_data` → ECharts）

- **横轴**：每个含非空 `values` 的 `parsed_data` 消息对应曲线上 **一个** 采样点；**X 为浏览器收到该消息时的本地时间（毫秒）**，不使用报文里未单独约定的「设备时间」字段。
- **多通道**：同一行里多个键在同一 X 上同时更新；**曾出现过的键**若在某后续行未再出现，该点补 **空值**（折线可断开），通道列表仍随新键名动态增加。

**示例（每行一帧，设备侧行尾须发送换行）：**

```text
temp=23.5,hum=55
adc0:1023, adc1:512, flags=0x01
x=1.2e-3, y=-4
```


## 前端发送逻辑摘要（`static/app.js`）


- 页面在**已连接**时通过 **`POST /api/send`** 提交 **`bytes_b64`**，与 Serial / TCP / **UDP** 共用同一逻辑。
- 组包顺序：**正文**（UTF-8 或 HEX 解析）→ **校验字节**（仅对正文计算）→ **行尾**（UTF-8 下的 LF/CR/CRLF）。
- HEX 模式：支持 `AA 55 01` 与 `AA550102` 等形式；非法时写 `[ERR]` 日志，不弹窗。


## 浏览器本地存储（仅前端）


| 键名 | 用途 |
|------|------|
| `webdbg_ui_lang_v1` | 界面语言 |
| `webdbg_cmd_history_v1` | 发送历史，最多 100 条 |
| `webdbg_tcp_recent_v1` | 最近 TCP 成功连接，最多 3 条 |
| `webdbg_tcp_form_v1` | 上次填写的 Host / Port |
| `webdbg_ui_mode_v1` | 上次选择的通信方式（Serial/TCP/UDP） |
| `webdbg_tx_echo_v1` | 是否开启 TX 回显到日志 |


## 可调常量（`static/app.js` 等）


| 常量 | 默认 | 说明 |
|------|------|------|
| `MAX_LOG_LINES` | 10000 | 日志 DOM 行数上限，超出删最旧 |
| `MAX_POINTS` | 1000 | 曲线保留采样点数上限 |
| `MAX_CMD_HIST` | 100 | 发送历史条数上限 |
| `MAX_TCP_RECENT` | 3 | TCP 最近连接条数 |
| 状态轮询间隔 | 3000 ms | 已连接或连接中时轮询 `/api/status` |


标题旁徽章显示 **当前量 / 上限**；接近或达到上限时样式提示。


## 静态资源缓存


若浏览器强缓存脚本/样式，可修改 **`static/index.html`** 中 `i18n.js` / `app.js` / `style.css` 的 **`?v=`** 查询参数以强制刷新。


## 本地测试


1. **TCP**  
   - 终端 A：`python scripts/tcp_test_server.py --port 5000`  
   - 终端 B：启动 `uvicorn`，页面 TCP 填 `127.0.0.1:5000` 后连接。

2. **UDP**  
   - 页面勾选监听并填本地端口；终端：`python scripts/udp_sender.py --host 127.0.0.1 --port <端口>`。

3. **串口**  
   - Windows 可用 **com0com** 等虚拟对口；一端跑 `python scripts/serial_mock.py --port COMx`，页面连接另一端。


## FAQ

### 这个项目可以替代 Arduino 串口监视器吗？

可以。它覆盖串口日志查看与发送，同时还补充了 **TCP / UDP**、HEX 发送、校验算法、行尾控制和网页端实时图表等能力。

### 支持类似 Arduino Serial Plotter 的曲线显示吗？

支持。项目会把解析出的数值字段按通道名动态绘制为多通道曲线，适合观察传感器、ADC、状态量等实时变化。

### 能用来做 TCP 或 UDP 调试吗？

可以。它不仅支持串口，还支持 **TCP Client** 和 **UDP 收发 / 本地监听**，适合网络设备联调。

### 这个工具能离线使用吗？

可以。它是**本地运行、浏览器访问**的调试工具，不依赖账号系统、数据库或云端服务。

### 适合哪些设备或项目？

适合 **Arduino**、**ESP32**、**STM32**、串口模块、Wi-Fi 模块、传感器网关，以及需要同时查看日志和数值曲线的嵌入式设备调试场景。


## 注意事项


- 浏览器**不能**直接访问硬件串口；所有通信由本机后端完成。
- 关闭程序或 `uvicorn` 时，后端在 lifespan 内释放串口 / Socket。
- 依赖以 **`requirements.txt`** 为准；未在仓库内锁定次要版本时，以实际安装环境为准。


## 许可证


本项目 **SerialNet Debug Studio** 在 **Apache License 2.0** 下授权使用，完整条文见仓库根目录 [`LICENSE`](LICENSE)。

- **Copyright © 2026 Allen Liao**；简述见 [`NOTICE`](NOTICE)，许可全文见 [`LICENSE`](LICENSE)。
- 第三方依赖库（如 FastAPI、Uvicorn、pyserial 等）及前端 CDN 资源仍遵循其各自许可证。
