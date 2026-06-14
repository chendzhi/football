# MCP Video Processing Server

全功能视频处理 MCP Server — 让 Claude 直接操作视频。

支持 **58 个工具**，覆盖 8 大类：自动剪辑、去水印、批量处理、AI 辅助、画质增强、智能分析、输出分享、实用工具。

---

## 目录

- [快速开始](#快速开始)
- [系统要求](#系统要求)
- [FFmpeg 安装指南](#ffmpeg-安装指南)
- [安装步骤](#安装步骤)
- [配置方法](#配置方法)
- [功能列表](#功能列表)
- [使用示例](#使用示例)
- [常见问题](#常见问题)
- [项目结构](#项目结构)

---

## 快速开始

```bash
# 1. 安装 FFmpeg（见下方指南）

# 2. 一键安装
# Windows:
install.bat
# Linux/macOS:
chmod +x install.sh && ./install.sh

# 3. 配置 Claude Desktop（见配置方法）

# 4. 在对话中说：
#    "把 video.mp4 压缩到适合微信发送的大小"
#    "检测这个视频的静音段落"
#    "自动生成日文字幕"
```

---

## 系统要求

| 项目 | 最低要求 | 说明 |
|------|---------|------|
| Python | 3.10+ | [python.org](https://www.python.org/downloads/) |
| FFmpeg | 5.0+ | 核心视频处理引擎 |
| 硬盘空间 | 1GB+ | 用于临时文件和处理输出 |
| 内存 | 4GB+ | Whisper 模型需要额外内存 |

**可选依赖**（不安装则相应功能不可用）：
- `openai-whisper` — 语音转文字 / 自动字幕
- `edge-tts` — 文字转语音
- `openai` / `anthropic` — AI 视觉分析（不装则用 OpenCV 基础分析）

---

## FFmpeg 安装指南

### Windows

**方式一：winget（推荐，Windows 11）**

```powershell
winget install "FFmpeg (Essentials Build)"
```

**方式二：Chocolatey**

```powershell
choco install ffmpeg
```

**方式三：手动安装**

1. 访问 <https://www.gyan.dev/ffmpeg/builds/>
2. 下载 **ffmpeg-release-essentials.zip**
3. 解压到 `C:\ffmpeg\`
4. 将 `C:\ffmpeg\bin\` 添加到系统 PATH：
   - 开始菜单 → 搜索"环境变量" → 编辑系统环境变量
   - 环境变量 → 系统变量 → Path → 新建 → `C:\ffmpeg\bin\`
5. 重启终端，输入 `ffmpeg -version` 验证

### macOS

```bash
brew install ffmpeg
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install ffmpeg
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install ffmpeg
```

---

## 安装步骤

### 自动安装

**Windows：** 双击 `install.bat`

**Linux/macOS：**

```bash
chmod +x install.sh
./install.sh
```

### 手动安装

```bash
# 1. 创建虚拟环境
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows

# 2. 安装依赖
pip install -r requirements.txt

# 3. 验证
python -c "import mcp; import cv2; print('OK')"
```

---

## 配置方法

### 1. 复制环境变量配置

```bash
cp .env.example .env
# 编辑 .env，填入 API Key（可选）
```

### 2. 配置 Claude Desktop

找到 Claude Desktop 配置文件：

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

将 `claude_desktop_config.json` 中的 `mcpServers.video-processing` 配置合并进去。

### 3. 配置示例

```json
{
  "mcpServers": {
    "video-processing": {
      "command": "python",
      "args": ["/path/to/jianji/mcp_server.py"],
      "env": {
        "WHISPER_MODEL": "tiny"
      }
    }
  }
}
```

### 4. 重启 Claude Desktop

重启后在对话中描述视频处理需求即可。

---

## 功能列表

### 一、自动剪辑（7 个工具）

| 工具 | 说明 |
|------|------|
| `trim_video` | 按指定起止时间裁剪视频 |
| `smart_cut` | 智能自动剪辑：检测静音段/高光时刻，自动切片 |
| `remove_heading_trailer` | 自动识别并删除片头片尾（黑屏/Logo检测） |
| `scene_split` | 按镜头切换自动分割视频 |
| `merge_videos` | 多视频无缝拼接，支持转场 |
| `stabilize` | 画面防抖处理 |
| `auto_highlight` | 自动提取精彩片段（音频+画面+人脸综合） |

### 二、去水印（5 个工具）

| 工具 | 说明 |
|------|------|
| `remove_watermark_by_blur` | 模糊覆盖去水印（指定 x, y, w, h） |
| `remove_watermark_by_crop` | 裁剪边缘去水印 |
| `remove_watermark_ai` | AI 智能填充（OpenCV inpainting） |
| `batch_remove_watermark` | 批量去除相同位置水印 |
| `detect_watermark_position` | 自动检测水印位置（边缘检测） |

### 三、批量处理（10 个工具）

| 工具 | 说明 |
|------|------|
| `add_subtitle` | 添加 SRT 字幕文件 |
| `auto_generate_subtitle` | Whisper 自动语音识别生成字幕 |
| `add_background_music` | 添加背景音乐，支持音量调节 |
| `add_transition` | 视频片段间添加转场效果 |
| `batch_process_folder` | 批量处理，支持链式操作 |
| `batch_convert_format` | 批量转换格式 |
| `smart_compress` | 智能压缩（自动分析调整码率） |
| `batch_rename` | 批量重命名（模板化） |
| `parallel_process` | 并行处理，多核加速 |
| `resume_batch` | 断点续传，从中断处继续 |

### 四、AI 视频生成辅助（6 个工具）

| 工具 | 说明 |
|------|------|
| `generate_ai_prompts` | 生成适配多模型的优化提示词 |
| `text_to_speech` | 生成语音旁白（Edge TTS） |
| `image_to_prompt` | 图片反向分析，生成 AI 视频提示词 |
| `suggest_ai_workflow` | 生成完整 AI 视频制作工作流 |
| `recommend_bgm_by_mood` | 根据情绪推荐 BGM |
| `extract_scene_description` | 从视频提取画面描述 |

### 五、画质增强（7 个工具）

| 工具 | 说明 |
|------|------|
| `upscale` | 超分辨率放大（2x/4x） |
| `interpolate` | 插帧补帧（如 24fps → 60fps） |
| `auto_color_correct` | 自动色彩校正 |
| `denoise` | 视频去噪 |
| `sharpen` | 边缘锐化 |
| `enhance_dark` | 暗光增强 |
| `deinterlace` | 去隔行扫描 |

### 六、智能分析（8 个工具）

| 工具 | 说明 |
|------|------|
| `analyze_video_info` | 获取详细元信息 |
| `detect_scene_type` | 识别场景类型 |
| `detect_faces` | 人脸检测 |
| `speech_to_text` | 语音转文字 |
| `find_duplicate_segments` | 检测重复/相似片段 |
| `detect_silence` | 检测静音段落 |
| `detect_loudness_peaks` | 检测音量峰值（高光候选） |
| `estimate_complexity` | 评估画面复杂度 |

### 七、输出与分享（5 个工具）

| 工具 | 说明 |
|------|------|
| `export_to_jianying` | 导出剪映/CapCut 草稿文件 |
| `export_multi_ratio` | 同时输出多种画面比例 |
| `generate_preview_gif` | 生成预览 GIF 动图 |
| `extract_thumbnail` | 提取缩略图 |
| `generate_spritesheet` | 生成视频预览雪碧图 |

### 八、实用工具（10 个工具）

| 工具 | 说明 |
|------|------|
| `compress_for_wechat` | 微信朋友圈优化压缩 |
| `compress_for_douyin` | 抖音/快手优化压缩 |
| `extract_audio` | 提取音频 |
| `replace_audio` | 替换视频音轨 |
| `adjust_volume` | 调整音量 |
| `speed_change` | 变速（保持音高） |
| `reverse_video` | 倒放视频 |
| `rotate_and_flip` | 旋转/翻转 |
| `add_text_overlay` | 添加文字水印/标题 |
| `add_image_overlay` | 添加图片水印 |

---

## 使用示例

以下是在 Claude 对话中自然语言描述即可，Claude 会自动调用对应工具：

### 自动剪辑

> "把 video.mp4 的高光片段提取出来，输出到 highlights/ 文件夹"

> "把 movie.mp4 按镜头切换点切割成独立片段"

### 去水印

> "把 video.mp4 右上角那个 Logo 模糊掉，位置大约是 x=1200 y=30 w=150 h=50"

> "这个文件夹里所有视频都有相同位置的水印，全部去掉"

### 批量处理

> "把 recordings/ 里的所有视频：先生成中文字幕，再加背景音乐 bgm.mp3（音量 0.3），输出到 output/"

> "把这三个视频拼接起来，中间加淡入淡出转场"

### AI 辅助

> "我要做一个 30 秒的赛博朋克城市街景视频，帮我生成适合 Runway Gen-4 的提示词"

> "给这段视频生成日文语音旁白：'こんにちは、今日は東京の街をご案内します'"

### 画质增强

> "把这段老视频做去噪和锐化处理"

> "把这个 30fps 的游戏录像补帧到 60fps"

### 实用工具

> "导出 video.mp4 的音频为 MP3"

> "给视频加上标题文字'精彩瞬间'，显示在顶部居中，前5秒显示"

---

## 常见问题

### Q: 提示 "ffmpeg: command not found"

FFmpeg 未安装或不在 PATH 中。参考 [FFmpeg 安装指南](#ffmpeg-安装指南)。

### Q: 中文语音识别不准确怎么办？

升级 Whisper 模型：在 `.env` 中设置 `WHISPER_MODEL=medium` 或 `large`。

### Q: 处理大视频时内存不足？

- 使用 `smart_compress` 先压缩视频
- Whisper 使用 `tiny` 或 `base` 模型

### Q: 水印检测不准确？

`detect_watermark_position` 基于边缘检测，可能不准。建议手动指定坐标后使用 `remove_watermark_by_blur`。

### Q: 剪映草稿导入失败？

`export_to_jianying` 导出的格式基于逆向工程，可能不兼容最新版剪映。

### Q: 支持 macOS/Linux 吗？

全部跨平台支持，只需安装对应系统的 FFmpeg。

### Q: 有没有 GUI 界面？

不需要 GUI。通过 Claude 对话即可操作，这是 MCP Server 的核心优势。

---

## 项目结构

```
jianji/
├── mcp_server.py                # MCP Server 主程序（58个工具）
├── requirements.txt             # Python 依赖列表
├── install.sh                   # Linux/macOS 安装脚本
├── install.bat                  # Windows 安装脚本
├── claude_desktop_config.json   # Claude Desktop 配置模板
├── .env.example                 # 环境变量示例
└── README.md                    # 本文件
```

---

## 许可证

MIT License. 开源使用。
