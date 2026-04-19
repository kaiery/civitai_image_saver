// ==UserScript==
// @name         Civitai Image Saver
// @namespace    https://github.com/kaiery/civitai_image_saver
// @version      1.1.2
// @description  一键保存 Civitai 图片及其元数据，支持导入导出和状态管理
// @author       kaiery
// @match        https://civitai.com/models/*
// @match        https://civitai.red/models/*
// @run-at       document-idle
// @grant        none
// @license      GPL-3.0
// @homepageURL  https://github.com/kaiery/civitai_image_saver
// @supportURL   https://github.com/kaiery/civitai_image_saver/issues
// @updateURL    https://github.com/kaiery/civitai_image_saver/raw/main/civitai_image_saver.user.js
// @downloadURL  https://github.com/kaiery/civitai_image_saver/raw/main/civitai_image_saver.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 🔧 调试开关【修改此处即可切换显示模式】
    // ==========================================
    // true  = 显示所有调试功能（扫描按钮、API测试、日志区域）
    // false = 仅显示导入导出功能（生产模式）
    const DEBUG_MODE = false;

    // ==========================================
    // 核心提取逻辑
    // ==========================================

    /**
     * 从当前URL提取 modelId
     * 支持格式：
     * - /models/1965943
     * - /models/1965943?modelVersionId=xxx
     * - /models/1965943/slug-name...
     */
    function getModelId() {
        const path = window.location.pathname; // 例如 /models/1965943/xxxx
        const match = path.match(/\/models\/(\d+)/);
        return match ? match[1] : '未找到';
    }

    /**
     * 扫描DOM提取 modelVersionId
     * 策略：查找含有 /api/download/models/xxx 的链接
     * 优先查找包含 "Download" 文本的按钮，或者直接提取第一个匹配的下载链接
     */
    function scanModelVersionId() {
        // 查找所有符合下载接口模式的<a>标签
        const links = document.querySelectorAll('a[href*="/api/download/models/"]');
        
        // 遍历查找，提取ID
        // 为什么遍历？因为页面上可能由多个链接，通常主下载按钮是最醒目的
        // 这里简单粗暴提取第一个匹配数字的
        for (const link of links) {
            const href = link.getAttribute('href');
            // href示例: /api/download/models/2414241?type=Model...
            const match = href.match(/\/api\/download\/models\/(\d+)/);
            if (match) {
                return match[1];
            }
        }
        
        // 如果没找到，尝试从URL参数兜底获取（虽然需求说主要靠网页元素过滤，但URL有的话也是个来源）
        const urlParams = new URLSearchParams(window.location.search);
        const urlVerId = urlParams.get('modelVersionId');
        if (urlVerId) return urlVerId + ' (来自URL)';

        return '未找到 (请确保页面加载完成)';
    }

    // ==========================================
    // UI 界面
    // ==========================================

    // 注入 CSS 样式（使用伪类，避免 JS 事件监听器）
    const style = document.createElement('style');
    style.textContent = `
        /* 蓝色角标（未保存） */
        [data-poc-badge="unsaved"] {
            background: rgba(0, 119, 255, 0.56) !important;
        }
        [data-poc-badge="unsaved"]:hover {
            background: rgba(0, 119, 255, 0.85) !important;
        }
        [data-poc-badge="unsaved"]:active {
            background: rgba(0, 80, 200, 1) !important;
        }

        /* 绿色角标（已保存） */
        [data-poc-badge="saved"] {
            background: rgba(46, 204, 113, 0.8) !important;
        }
        [data-poc-badge="saved"]:hover {
            background: rgba(46, 204, 113, 0.95) !important;
        }
        [data-poc-badge="saved"]:active {
            background: rgba(30, 170, 90, 1) !important;
        }

        /* 导入导出按钮三色效果 */
        .cis-btn-green {
            background: #2f9e44 !important;
        }
        .cis-btn-green:hover {
            background: #2b8a3e !important;
        }
        .cis-btn-green:active {
            background: #237032 !important;
        }

        .cis-btn-gray {
            background: #555 !important;
        }
        .cis-btn-gray:hover {
            background: #666 !important;
        }
        .cis-btn-gray:active {
            background: #444 !important;
        }

        .cis-btn-blue {
            background: #1971C2 !important;
        }
        .cis-btn-blue:hover {
            background: #1864ab !important;
        }
        .cis-btn-blue:active {
            background: #15558d !important;
        }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed',
        right: '20px',
        bottom: '100px',
        width: '400px', // 加宽面板
        maxHeight: '80vh',
        padding: '15px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        color: '#fff',
        borderRadius: '8px',
        zIndex: '100000',
        display: 'none',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        border: '1px solid #555',
        fontFamily: 'monospace',
    });

    const title = document.createElement('div');
    title.textContent = 'ID 提取 & 接口测试';
    title.style.fontWeight = 'bold';
    title.style.borderBottom = '1px solid #444';
    title.style.paddingBottom = '5px';
    title.style.display = DEBUG_MODE ? 'block' : 'none'; // 🔧 调试模式控制
    panel.appendChild(title);

    // 显示 modelId (调试专用)
    const rowModelId = document.createElement('div');
    rowModelId.innerHTML = '<span style="color:#aaa">Model ID:</span> <span id="poc-mid" style="color:#8f8; font-weight:bold">--</span>';
    rowModelId.style.display = DEBUG_MODE ? 'block' : 'none'; // 🔧 调试模式控制
    panel.appendChild(rowModelId);

    // 显示 modelVersionId (调试专用)
    const rowVersionId = document.createElement('div');
    rowVersionId.innerHTML = '<span style="color:#aaa">Version ID:</span> <span id="poc-vid" style="color:#8ff; font-weight:bold">--</span>';
    rowVersionId.style.display = DEBUG_MODE ? 'block' : 'none'; // 🔧 调试模式控制
    panel.appendChild(rowVersionId);

    // 按钮行 (调试专用)
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
        display: DEBUG_MODE ? 'flex' : 'none', // 🔧 调试模式控制
        gap: '5px',
        marginTop: '5px'
    });

    // 刷新按钮 (用于手动触发扫描)
    const btnScan = document.createElement('button');
    btnScan.textContent = '扫描 ID';
    Object.assign(btnScan.style, {
        padding: '6px 10px',
        cursor: 'pointer',
        backgroundColor: '#444',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        flex: 1
    });
    btnScan.addEventListener('click', updateDisplay);

    // 请求详情按钮
    const btnFetch = document.createElement('button');
    btnFetch.textContent = 'API 详情';
    Object.assign(btnFetch.style, {
        padding: '6px 10px',
        cursor: 'pointer',
        backgroundColor: '#228be6',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        flex: 1
    });
    btnFetch.addEventListener('click', fetchModelData);
    
    // 添加图片角标按钮
    const btnImages = document.createElement('button');
    btnImages.textContent = '图片角标';
    Object.assign(btnImages.style, {
        padding: '6px 10px',
        cursor: 'pointer',
        backgroundColor: '#e67700', // Orange
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        flex: 1
    });
    btnImages.addEventListener('click', addImageBadges);
    
    btnRow.appendChild(btnScan);
    btnRow.appendChild(btnFetch);
    btnRow.appendChild(btnImages); // 新增按钮
    panel.appendChild(btnRow);

    // 结果展示区域 (隐藏)
    const resultLabel = document.createElement('div');
    resultLabel.textContent = '操作日志 / API 结果:';
    resultLabel.style.fontWeight = 'bold';
    resultLabel.style.marginTop = '5px';
    resultLabel.style.display = 'none'; // 默认隐藏
    panel.appendChild(resultLabel);

    const resultArea = document.createElement('textarea');
    Object.assign(resultArea.style, {
        width: '100%',
        height: '150px', // 缩小高度
        backgroundColor: '#1a1a1a',
        color: '#ddd',
        border: '1px solid #444',
        borderRadius: '4px',
        fontSize: '11px',
        resize: 'vertical',
        padding: '5px',
        whiteSpace: 'pre-wrap',
        display: 'none' // 默认隐藏
    });
    panel.appendChild(resultArea);

    // ==========================================
    // 数据持久化管理 (POC 9)
    // ==========================================
    const STORAGE_KEY = 'civitai_saved_images_v1';
    let savedImagesMap = new Map(); // id -> { mid, vid, ts }

    // 加载数据
    function loadSavedImages() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    list.forEach(item => {
                        if (item.id) savedImagesMap.set(String(item.id), item);
                    });
                }
            }
            console.log(`[POC 9] 已加载 ${savedImagesMap.size} 条已保存记录`);
        } catch (e) {
            console.error('加载本地记录失败', e);
        }
    }
    
    // 保存数据（重复下载时更新所有字段）
    function saveImageState(imgId, mid, vid, url) {
        const idStr = String(imgId);
        savedImagesMap.set(idStr, {
            id: imgId,
            mid: mid,
            vid: vid,
            url: url || '', // 原始图片URL
            ts: Date.now()  // 每次都更新时间戳
        });
        persistData();
    }

    function persistData() {
        const list = Array.from(savedImagesMap.values());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        updateStats();
    }

    // ==========================================
    // 数据管理 UI
    // ==========================================
    const dataSection = document.createElement('div');
    Object.assign(dataSection.style, {
        borderTop: DEBUG_MODE ? '1px solid #444' : 'none', // 🔧 调试模式显示分割线
        paddingTop: '10px',
        marginTop: DEBUG_MODE ? '10px' : '0px', // 🔧 调试模式显示间距
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    });

    const statsDiv = document.createElement('div');
    statsDiv.style.fontSize = '12px';
    statsDiv.style.color = '#ccc';
    dataSection.appendChild(statsDiv);

    function updateStats() {
        statsDiv.textContent = `当前已记录: ${savedImagesMap.size} 张图片`;
    }

    // 导出按钮
    const btnExport = document.createElement('button');
    btnExport.textContent = '导出数据 (JSON)';
    btnExport.className = 'cis-btn-green'; // 三色效果
    Object.assign(btnExport.style, {
        padding: '6px', cursor: 'pointer',
        color: '#fff', border: 'none', borderRadius: '4px'
    });
    btnExport.addEventListener('click', () => {
        const list = Array.from(savedImagesMap.values());
        const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
        const filename = `civitai_saved_${new Date().toISOString().slice(0,10)}.json`;
        downloadBlob(blob, filename);
        alert(`✅ 导出成功！\n已导出 ${list.length} 条记录\n文件名: ${filename}`);
    });
    dataSection.appendChild(btnExport);

    // 导入容器
    const importContainer = document.createElement('div');
    importContainer.style.display = 'flex';
    importContainer.style.flexDirection = 'column';

    // 隐藏的真实文件输入框
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none'; // 隐藏
    
    // 模拟的导入按钮
    const btnImport = document.createElement('button');
    btnImport.textContent = '导入数据 (JSON)';
    btnImport.className = 'cis-btn-green'; // 三色效果
    Object.assign(btnImport.style, {
        padding: '6px', cursor: 'pointer',
        color: '#fff', border: 'none', borderRadius: '4px'
    });
    btnImport.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // 弹窗选择导入模式
        const mode = confirm('请选择导入模式：\n\n【确定】= 合并模式（相同ID以最新时间戳为准）\n【取消】= 覆盖模式（清空本地数据，完全替换）');
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const list = JSON.parse(evt.target.result);
                if (!Array.isArray(list)) {
                    alert('文件格式错误：必须是 JSON 数组');
                    return;
                }
                
                if (mode) {
                    // === 合并模式 ===
                    let added = 0, updated = 0;
                    list.forEach(item => {
                        if (!item.id) return;
                        const idStr = String(item.id);
                        const existing = savedImagesMap.get(idStr);
                        
                        if (!existing) {
                            // 新记录
                            savedImagesMap.set(idStr, item);
                            added++;
                        } else {
                            // 已存在，比较时间戳
                            const existingTs = existing.ts || 0;
                            const importTs = item.ts || 0;
                            if (importTs > existingTs) {
                                // 导入的数据更新，覆盖
                                savedImagesMap.set(idStr, item);
                                updated++;
                            }
                            // 否则保持原有数据，不做任何操作
                        }
                    });
                    persistData();
                    alert(`✅ 合并完成！\n新增: ${added} 条\n更新: ${updated} 条\n总计: ${savedImagesMap.size} 条`);
                } else {
                    // === 覆盖模式 ===
                    savedImagesMap.clear(); // 清空本地
                    list.forEach(item => {
                        if (item.id) savedImagesMap.set(String(item.id), item);
                    });
                    persistData();
                    alert(`✅ 覆盖完成！\n已清空本地数据并导入 ${savedImagesMap.size} 条记录`);
                }
                
                // 重新刷新界面状态
                document.querySelectorAll('[data-has-poc-badge="true"]').forEach(el => {
                    delete el.dataset.hasPocBadge; // 重置标记
                    // 只删除我们的角标，不影响 Civitai 网站自己的元素
                    const badge = el.querySelector('[data-poc-badge-element="true"]');
                    if (badge) badge.remove();
                });
                addImageBadges(); // 重新渲染
                
            } catch (err) {
                alert('解析失败: ' + err.message);
            }
        };
        reader.readAsText(file);
        
        // 重置 input，允许重复选择同一文件
        fileInput.value = '';
    });
    importContainer.appendChild(fileInput);
    importContainer.appendChild(btnImport);
    dataSection.appendChild(importContainer);

    // 调试开关 (仅在调试模式显示)
    const btnToggleLog = document.createElement('button');
    btnToggleLog.textContent = '显示/隐藏 调试日志';
    btnToggleLog.className = 'cis-btn-gray'; // 三色效果
    Object.assign(btnToggleLog.style, {
        padding: '4px', cursor: 'pointer',
        color: '#ddd', border: 'none', borderRadius: '4px', fontSize: '10px',
        display: DEBUG_MODE ? 'block' : 'none' // 🔧 调试模式控制
    });
    btnToggleLog.addEventListener('click', () => {
        const isHidden = resultArea.style.display === 'none';
        resultArea.style.display = isHidden ? 'block' : 'none';
        resultLabel.style.display = isHidden ? 'block' : 'none';
    });
    dataSection.appendChild(btnToggleLog);

    panel.appendChild(dataSection);

    // 初始化加载
    loadSavedImages();
    updateStats();

    // 业务逻辑：添加图片角标
    function addImageBadges() {
        if (addImageBadges.isPending) return;
        addImageBadges.isPending = true;

        requestAnimationFrame(() => {
            addImageBadges.isPending = false;
            const anchors = document.querySelectorAll('a[href^="/images/"]');
            
            anchors.forEach(anchor => {
                if (anchor.dataset.hasPocBadge) return;
                
                const img = anchor.querySelector('img');
                if (!img) return;

                const href = anchor.getAttribute('href'); 
                const match = href.match(/\/images\/(\d+)/);
                if (!match) return;
                const imageId = match[1];

                const src = img.src; // 预览图地址
                
                try {
                    const urlObj = new URL(src);
                    const pathParts = urlObj.pathname.split('/');
                    const filename = pathParts[pathParts.length - 1];
                    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
                    const ext = extMatch ? extMatch[1] : 'jpeg';
                    const basePath = pathParts.slice(0, pathParts.length - 2).join('/');
                    const originalUrl = `${urlObj.origin}${basePath}/original=true/${imageId}.${ext}`;
                    
                    anchor.style.position = 'relative';
                    anchor.dataset.hasPocBadge = 'true';

                    // 状态判断
                    const isSaved = savedImagesMap.has(String(imageId));

                    const badge = document.createElement('div');
                    badge.textContent = isSaved ? 'SAVED' : 'SAVE'; // 状态文本
                    badge.dataset.pocBadgeElement = 'true'; // 唯一标识，用于安全删除
                    badge.dataset.pocBadge = isSaved ? 'saved' : 'unsaved'; // CSS 状态类
                    
                    Object.assign(badge.style, {
                        position: 'absolute',
                        top: '5px',
                        left: '5px',
                        // background 由 CSS 控制
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: isSaved ? 'default' : 'pointer',
                        zIndex: '10',
                        userSelect: 'none' // 防止文字选中
                    });

                    // 点击事件：下载逻辑
                    badge.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const now = new Date().toLocaleTimeString();
                        resultArea.value = `[${now}] 开始处理图片 ID: ${imageId} ...\n` + resultArea.value;

                        // 1. 准备文件名
                        let filePrefix = 'civitai_image';
                        if (extractedModelData && extractedModelData.modelVersions && extractedModelData.modelVersions.length > 0) {
                            // 尝试找到当前版本的 primary file
                            // 由于 extractedModelData 可能包含多个版本，我们需要知道当前点击图片属于哪个版本？
                            // Civitai 图片流通常是一堆混在一起的，或者当前页面的 modelVersionId
                            // 简化逻辑：优先使用当前过滤的版本，如果没有则使用 extractedModelData 的第一个版本（通常是当前页面版本）
                            // 更严谨逻辑：API 返回的 image data 里包含 versionId，可以校验。
                            
                            // 这里先尝试获取当前 Primary File Name
                            // 假设当前页面展示的版本即为图片所属版本（不一定对，但在 POC 阶段可接受）
                            // 或者我们稍微 Hack 一下，等下拿到 generation data 后再决定文件名？
                            // 需求说：从 extractedModelData 获取。
                            
                            let targetVersion = null;
                             // 尝试用 lastFilteredVid 匹配
                            if (typeof lastFilteredVid !== 'undefined' && lastFilteredVid) {
                                targetVersion = extractedModelData.modelVersions.find(v => v.id === lastFilteredVid);
                            }
                            // 兜底：用第一个
                            if (!targetVersion) targetVersion = extractedModelData.modelVersions[0];

                            if (targetVersion && targetVersion.primaryFile) {
                                // 1. 去除后缀
                                const pureName = targetVersion.primaryFile.name.replace(/\.[^.]+$/, "");
                                // 2.【加强版】统一替换非法字符、空格等为下划线
                                // 正则涵盖: / \ ? % * : | " < > 以及 空格( ) 和 控制字符(\x00-\x1f)
                                filePrefix = pureName.replace(/[/\\?%*:|"<>~ \x00-\x1f]+/g, '_');
                            }
                        }
                        
                        const baseFileName = `${filePrefix}_${imageId}`;
                        console.log('目标文件名:', baseFileName);

                        // 2. 获取 Generation Data
                        let currentMid = null;
                        let currentVid = null;
                        
                        try {
                            const genUrl = `https://civitai.com/api/trpc/image.getGenerationData?input=${encodeURIComponent(JSON.stringify({json:{id:parseInt(imageId),authed:true}}))}`;
                            const resp = await fetch(genUrl);
                            const jsonBody = await resp.json();
                            
                            const coreData = jsonBody?.result?.data?.json;
                            if (!coreData) throw new Error('API 返回结构异常');
                            
                            // 提取 meta 和 type
                            const metaDataToSave = {
                                type: coreData.type,
                                meta: coreData.meta
                            };
                            
                            // 3. 下载 JSON
                            downloadBlob(
                                new Blob([JSON.stringify(metaDataToSave, null, 2)], { type: 'application/json' }),
                                `${baseFileName}.json`
                            );
                            
                            resultArea.value = `[${now}] JSON 元数据已保存。\n` + resultArea.value;

                            // 提取模型ID和版本ID（用于后续保存状态）
                            if (coreData.resources && Array.isArray(coreData.resources)) {
                                const res = coreData.resources[0];
                                if (res) {
                                    if (res.modelId) currentMid = res.modelId;
                                    if (res.versionId) currentVid = res.versionId;
                                }
                            }

                        } catch (err) {
                            console.error('获取元数据失败', err);
                            resultArea.value = `[${now}] 获取元数据失败: ${err.message}\n` + resultArea.value;
                        }

                        // 4. 下载图片 (尝试使用 fetch blob 来强制重命名)
                        // 注意：跨域问题。如果是 image.civitai.com，通常允许跨域。
                        try {
                            const imgResp = await fetch(originalUrl);
                            const imgBlob = await imgResp.blob();
                            downloadBlob(imgBlob, `${baseFileName}.${ext}`);
                            resultArea.value = `[${now}] 图片已保存。\n` + resultArea.value;
                        } catch (err) {
                            console.error('下载图片失败', err);
                            downloadUrl(originalUrl, `${baseFileName}.${ext}`);
                            resultArea.value = `[${now}] 图片下载触发 (可能文件名未生效): ${err.message}\n` + resultArea.value;
                        }

                        // 5. 更新状态为已保存
                        badge.textContent = 'SAVED';
                        badge.dataset.pocBadge = 'saved'; // 切换到已保存状态
                        badge.style.cursor = 'default';
                        
                        // 保存到存储（如果没有 mid/vid，尝试使用 extractedModelData 中的数据）
                        if (!currentMid && extractedModelData && extractedModelData.modelVersions) {
                            const targetVersion = extractedModelData.modelVersions.find(v => v.id === lastFilteredVid) || extractedModelData.modelVersions[0];
                            if (targetVersion) currentVid = targetVersion.id;
                            if (lastFetchedMid) currentMid = lastFetchedMid;
                        }
                        
                        saveImageState(imageId, currentMid, currentVid, originalUrl);
                        resultArea.value = `[${now}] 状态已更新 (${savedImagesMap.size} 张)。\n` + resultArea.value;
                    });

                    anchor.appendChild(badge);
                } catch (e) {
                    console.warn('解析图片URL失败', src, e);
                }
            });
        });
    }

    // 通用下载 helpers
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function downloadUrl(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank'; // 某些情况需要
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // ==========================================
    // 自动化 (MutationObserver)
    // ==========================================


    // 开关按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'CIS'; // POC 测试 -> CIS
    Object.assign(toggleBtn.style, {
        position: 'fixed',
        right: '116px',
        bottom: '7px',
        padding: '8px 12px',
        color: '#fff',
        border: '1px solid #1482e9ff',
        borderRadius: '4px',
        zIndex: '100001',
        cursor: 'pointer'
    });
    
    // 给开关按钮也加个三色效果 (使用 cis-btn-blue)
    toggleBtn.className = 'cis-btn-blue';

    document.body.appendChild(panel);
    document.body.appendChild(toggleBtn);

    toggleBtn.addEventListener('click', () => {
        const isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            updateDisplay();
        }
    });

    // 业务逻辑：请求API
    let extractedModelData = null; // 内部变量存储提取的数据

    async function fetchModelData() {
        const mid = getModelId();
        if (!mid || mid === '未找到') {
            resultArea.value = '错误: 无法获取 Model ID，请先扫描页面。';
            return;
        }

        resultArea.value = `正在请求: /api/v1/models/${mid} ...`;
        
        try {
            const resp = await fetch(`https://civitai.com/api/v1/models/${mid}`);
            if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
            const data = await resp.json();
            
            // 展示完整JSON
            resultArea.value = JSON.stringify(data, null, 2);
            
            // ==========================================
            // 数据提取逻辑 (POC 5)
            // ==========================================
            extractAndLogData(data);

        } catch (e) {
            resultArea.value = `请求失败: ${e.message}\n可能原因：跨域限制、网络问题或 ID 无效。`;
            console.error('Fetch error:', e);
        }
    }

    function extractAndLogData(data) {
        if (!data) return;

        // 获取当前通过 DOM 扫描到的 Version ID
        // 注意：scanModelVersionId() 可能返回 "12345 (来自URL)" 或 "未找到"
        const rawVidStr = scanModelVersionId();
        const vidMatch = rawVidStr.match(/(\d+)/);
        const scannedVid = vidMatch ? parseInt(vidMatch[1], 10) : null;
        
        if (!scannedVid) {
            console.warn('[POC 6] 未能获取有效的 scannedModelVersionId，无法过滤版本。');
        } else {
            console.log('[POC 6]以此 Version ID 进行过滤:', scannedVid);
        }

        // 过滤 modelVersions
        const allVersions = data.modelVersions || [];
        const filteredVersions = scannedVid 
            ? allVersions.filter(v => v.id === scannedVid) 
            : allVersions;

        // 提取所需字段
        const extracted = {
            name: data.name,
            modelVersions: filteredVersions.map(v => {
                // 查找 primary 文件
                const primaryFile = (v.files || []).find(f => f.primary === true);
                
                return {
                    id: v.id,
                    name: v.name,
                    baseModel: v.baseModel,
                    description: v.description,
                    primaryFile: primaryFile ? {
                        name: primaryFile.name,
                        primary: primaryFile.primary,
                        downloadUrl: primaryFile.downloadUrl
                    } : null
                };
            })
        };

        // 存储到内部变量
        extractedModelData = extracted;

        // Console 打印
        console.group('POC 6: 提取并过滤后的模型数据');
        console.log('【模型名】', extracted.name);
        
        if (extracted.modelVersions.length === 0) {
            console.warn('警告: 没有匹配的版本 (Scanned ID: ' + scannedVid + ')');
        }

        extracted.modelVersions.forEach(v => {
            console.group(`版本: ${v.name} (ID: ${v.id})`);
            console.log('【模型版本ID】', v.id);
            console.log('【模型版本名称】', v.name);
            console.log('【模型版本类型】', v.baseModel);
            console.log('【模型版本描述】', v.description ? (v.description.slice(0, 50) + '...') : '无');
            
            if (v.primaryFile) {
                console.log('【模型版本文件】(Primary)');
                console.log('  - 文件名:', v.primaryFile.name);
                console.log('  - 下载地址:', v.primaryFile.downloadUrl);
            } else {
                console.log('【模型版本文件】未找到 Primary 文件');
            }
            console.groupEnd();
        });
        console.groupEnd();
        
        // 追加到面板显示以便直观查看
        const logMsg = `\n[POC 6] 数据已过滤 (保留版本ID: ${scannedVid})\n匹配到的版本数: ${extracted.modelVersions.length}`;
        resultArea.value = logMsg + resultArea.value; // 插入最前或追加
    }

    btnFetch.addEventListener('click', fetchModelData);

    // 更新显示逻辑
    function updateDisplay() {
        const mid = getModelId();
        const vid = scanModelVersionId();

        document.getElementById('poc-mid').textContent = mid;
        document.getElementById('poc-vid').textContent = vid;
    }

    // ==========================================
    // 自动化 (MutationObserver & SPA Nav)
    // ==========================================

    let lastFetchedMid = null;
    let lastFetchedData = null;
    let lastFilteredVid = null;
    
    // 智能更新逻辑
    function autoFetchOrUpdate() {
        if (autoFetchOrUpdate.busy) return;
        autoFetchOrUpdate.busy = true;

        setTimeout(() => {
            const mid = getModelId();
            
            // 1. Model ID 变更 -> 重新请求
            if (mid && mid !== '未找到' && mid !== lastFetchedMid) {
                console.log(`[POC 7] 检测到新 Model ID (${mid})，准备发起请求...`);
                // 重置状态
                lastFetchedMid = mid; 
                lastFetchedData = null; 
                fetchModelData(); // 必须保证 fetchModelData 会更新 lastFetchedData
                autoFetchOrUpdate.busy = false;
                return;
            }

            // 2. Model ID 未变，检查 Version ID 变更
            // 需要获取当前的 vid
            const rawVidStr = scanModelVersionId();
            const vidMatch = rawVidStr.match(/(\d+)/);
            const currentVid = vidMatch ? parseInt(vidMatch[1], 10) : null;

            if (currentVid && currentVid !== lastFilteredVid) {
                console.log(`[POC 7] Model ID 未变，但 Version ID 变了 (${lastFilteredVid} -> ${currentVid})，重新过滤...`);
                
                if (lastFetchedData) {
                    extractAndLogData(lastFetchedData);
                } else {
                    // 只有 ID 没有数据（如页面刚加载）
                    if (mid && mid !== '未找到') fetchModelData();
                }
            }
            autoFetchOrUpdate.busy = false;
        }, 500); // 延时等待 DOM
    }

    // Hook History API
    function wrapHistory(type) {
        const original = history[type];
        return function () {
            const result = original.apply(this, arguments);
            triggerCheck();
            return result;
        };
    }
    
    history.pushState = wrapHistory('pushState');
    history.replaceState = wrapHistory('replaceState');
    window.addEventListener('popstate', triggerCheck);
    
    function triggerCheck() {
       setTimeout(autoFetchOrUpdate, 500); 
    }

    // MutationObserver
    const observer = new MutationObserver((mutations) => {
        // 1. 图片角标
        let shouldBadge = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldBadge = true;
                break;
            }
        }
        if (shouldBadge) addImageBadges();
        
        // 2. 也是检查数据更新的好时机 (throttle)
        if (!autoFetchOrUpdate.debounced) {
            autoFetchOrUpdate.debounced = setTimeout(() => {
                autoFetchOrUpdate();
                autoFetchOrUpdate.debounced = null;
            }, 1000);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 初始启动
    setTimeout(() => {
        addImageBadges();
        autoFetchOrUpdate();
    }, 1500);

    // ==========================================
    // Hack: 增强 fetchModelData 和 extractAndLogData
    // 以便它们能更新我们的缓存变量
    // ==========================================
    const _orgExtract = extractAndLogData;
    extractAndLogData = function(data) {
        _orgExtract(data);
        
        // 缓存数据
        lastFetchedData = data;
        const mid = getModelId();
        if(mid && mid !== '未找到') lastFetchedMid = mid;

        // 缓存当前过滤用的ID
        const rawVidStr = scanModelVersionId();
        const vidMatch = rawVidStr.match(/(\d+)/);
        if (vidMatch) lastFilteredVid = parseInt(vidMatch[1], 10);
    };

})();
