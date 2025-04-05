// 全局变量
let currentBucket = null;
let currentPrefix = '';
let currentObjects = [];
let s3Config = null;
let isUploading = false;
let contextMenuTarget = null;
let currentWorkspace = null;
let currentPreviewUrl = null;
let currentPreviewFile = null;

// DOM元素
const $bucketList = document.getElementById('bucket-list');
const $pathNavigation = document.getElementById('path-navigation');
const $fileList = document.getElementById('file-list');
const $statusText = document.getElementById('status-text');
const $statusRight = document.getElementById('status-right');
const $loadingOverlay = document.getElementById('loading-overlay');
const $configModal = document.getElementById('config-modal');
const $contextMenu = document.getElementById('context-menu');
const $workspaceModal = document.getElementById('workspace-modal');
const $currentWorkspace = document.getElementById('current-workspace');
const $workspaceList = document.getElementById('workspace-list');
const $previewModal = document.getElementById('preview-modal');
const $previewContent = document.getElementById('preview-content');
const $previewTitle = document.getElementById('preview-title');
const $downloadPreviewBtn = document.getElementById('download-preview-btn');

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  
  // 添加淡入效果
  document.body.style.opacity = '0';
  setTimeout(() => {
    document.body.style.transition = 'opacity 0.5s ease';
    document.body.style.opacity = '1';
  }, 100);
  
  // 加载当前工作空间
  loadCurrentWorkspace();
});

// 加载当前工作空间
function loadCurrentWorkspace() {
  currentWorkspace = window.s3.getCurrentWorkspace();
  
  if (currentWorkspace) {
    $currentWorkspace.textContent = currentWorkspace.name;
    
    // 加载当前工作空间的配置
    const savedConfig = window.s3.getConfig();
    if (savedConfig) {
      s3Config = savedConfig;
      initializeS3Client();
      loadBuckets();
    } else {
      showConfigModal();
    }
  } else {
    // 没有工作空间，显示工作空间模态框
    showWorkspaceModal();
  }
}

// 初始化S3客户端
function initializeS3Client() {
  try {
    window.s3.initClient(s3Config);
    updateStatusBar('已连接到S3服务', `区域: ${s3Config.region}`);
  } catch (error) {
    showNotification('初始化S3客户端失败: ' + error.message, 'error');
  }
}

// 初始化事件监听器
function initEventListeners() {
  // 配置表单提交
  document.getElementById('config-form').addEventListener('submit', function(e) {
    e.preventDefault(); // 阻止表单默认提交
  });
  
  // 保存配置按钮点击
  document.getElementById('save-config-btn').addEventListener('click', saveConfiguration);
  
  // 上传按钮点击
  document.getElementById('upload-btn').addEventListener('click', () => showUploadModal());
  
  // 路径导航点击实现刷新功能
  document.getElementById('path-navigation').addEventListener('click', function(e) {
    // 检查点击的是否为路径导航本身，而不是其子元素
    if (e.target === this) {
      refreshCurrentView();
    }
  });
  
  // 新建文件夹按钮点击
  document.getElementById('new-folder-btn').addEventListener('click', () => showNewFolderModal());
  
  // 关闭模态框按钮
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => hideAllModals());
  });
  
  // 预览下载按钮点击
  document.getElementById('download-preview-btn').addEventListener('click', () => {
    if (currentPreviewFile) {
      downloadFile(currentPreviewFile);
    }
  });
  
  // 上传表单提交
  document.getElementById('upload-form').addEventListener('submit', handleFileUpload);
  
  // 拖放上传区域
  const dropzone = document.getElementById('dropzone');
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('active');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('active');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      document.getElementById('upload-files').files = files;
      // 添加上传文件名预览
      updateFilePreview(files);
    }
  });
  
  // 监听文件选择变化，显示文件预览
  document.getElementById('upload-files').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      updateFilePreview(files);
    }
  });
  
  // 新建文件夹表单提交
  document.getElementById('new-folder-form').addEventListener('submit', handleCreateFolder);
  
  // 全局点击事件监听，隐藏上下文菜单
  document.addEventListener('click', () => {
    hideContextMenu();
  });
  
  // 添加按钮点击事件
  document.getElementById('add-config-btn').addEventListener('click', showConfigModal);
  
  // 工作空间选择器点击事件
  $currentWorkspace.addEventListener('click', showWorkspaceModal);
  
  // 新建工作空间按钮点击事件
  document.getElementById('create-workspace-btn').addEventListener('click', showNewWorkspaceModal);
  
  // 新建工作空间表单提交
  document.getElementById('new-workspace-form').addEventListener('submit', handleCreateWorkspace);
  
  // 编辑工作空间表单提交
  document.getElementById('edit-workspace-form').addEventListener('submit', handleEditWorkspace);
  
  // 删除工作空间按钮点击
  document.getElementById('delete-workspace-btn').addEventListener('click', handleDeleteWorkspace);
  
  // 侧边栏折叠按钮点击事件
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  
  // 加载侧边栏状态
  loadSidebarState();
}

// 更新文件预览
function updateFilePreview(files) {
  const uploadForm = document.getElementById('upload-form');
  let previewDiv = document.getElementById('file-preview');
  
  if (!previewDiv) {
    previewDiv = document.createElement('div');
    previewDiv.id = 'file-preview';
    previewDiv.className = 'file-preview';
    uploadForm.insertBefore(previewDiv, uploadForm.querySelector('.modal-footer'));
  }
  
  previewDiv.innerHTML = '<h4>已选择的文件:</h4><ul class="preview-list"></ul>';
  const previewList = previewDiv.querySelector('.preview-list');
  
  for (let i = 0; i < Math.min(files.length, 5); i++) {
    const file = files[i];
    const li = document.createElement('li');
    li.className = 'preview-item';
    
    const icon = getFileIcon(file.name);
    const size = formatFileSize(file.size);
    
    li.innerHTML = `
      <span class="preview-icon">${icon}</span>
      <div class="preview-details">
        <div class="preview-name">${file.name}</div>
        <div class="preview-size">${size}</div>
      </div>
    `;
    
    previewList.appendChild(li);
  }
  
  if (files.length > 5) {
    const li = document.createElement('li');
    li.className = 'preview-more';
    li.textContent = `...还有 ${files.length - 5} 个文件`;
    previewList.appendChild(li);
  }
}

// 加载存储桶
async function loadBuckets() {
  showLoading();
  try {
    const buckets = await window.s3.listBuckets();
    renderBucketList(buckets);
    updateStatusBar(`已加载 ${buckets.length} 个存储桶`, '');
    hideLoading();
    
    // 如果有存储桶且当前没有选中的存储桶，自动选择第一个
    if (buckets.length > 0 && !currentBucket) {
      // 获取排序后的第一个存储桶
      const bucketOrder = window.s3.getBucketOrder();
      let firstBucket;
      
      if (bucketOrder.length > 0) {
        // 按自定义顺序查找存在的第一个存储桶
        for (const bucketName of bucketOrder) {
          const exists = buckets.find(b => b.Name === bucketName);
          if (exists) {
            firstBucket = bucketName;
            break;
          }
        }
      }
      
      // 如果没找到排序中的存储桶，使用列表中的第一个
      if (!firstBucket) {
        firstBucket = buckets[0].Name;
      }
      
      // 选择第一个存储桶
      selectBucket(firstBucket);
    }
  } catch (error) {
    hideLoading();
    showNotification('加载存储桶失败: ' + error.message, 'error');
  }
}

// 渲染存储桶列表
function renderBucketList(buckets) {
  $bucketList.innerHTML = '';
  
  if (buckets.length === 0) {
    $bucketList.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">没有可用的存储桶</div></div>';
    return;
  }
  
  // 获取存储桶的自定义排序
  const bucketOrder = window.s3.getBucketOrder();
  let orderedBuckets = [...buckets];
  
  if (bucketOrder.length > 0) {
    // 按自定义顺序排序存储桶
    orderedBuckets.sort((a, b) => {
      const indexA = bucketOrder.indexOf(a.Name);
      const indexB = bucketOrder.indexOf(b.Name);
      
      // 如果两个存储桶都在自定义排序中
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      
      // 如果只有一个在自定义排序中，将其排在前面
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      
      // 如果都不在，按字母顺序排序
      return a.Name.localeCompare(b.Name);
    });
  }
  
  orderedBuckets.forEach(bucket => {
    const li = document.createElement('li');
    li.className = 'bucket-item';
    li.dataset.name = bucket.Name;
    li.innerHTML = `
      <span class="bucket-icon">📦</span>
      <span>${bucket.Name}</span>
      <span class="bucket-drag-handle">☰</span>
    `;
    
    li.addEventListener('click', () => {
      selectBucket(bucket.Name);
    });
    
    // 添加拖拽属性
    li.draggable = true;
    
    // 拖拽事件
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('dragenter', handleDragEnter);
    li.addEventListener('dragleave', handleDragLeave);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);
    
    $bucketList.appendChild(li);
  });
}

// 拖拽相关变量
let draggedItem = null;

// 拖拽开始
function handleDragStart(e) {
  draggedItem = this;
  
  // 可以设置拖拽图像和拖拽效果
  e.dataTransfer.effectAllowed = 'move';
  
  // 添加半透明效果
  setTimeout(() => {
    this.classList.add('dragging');
  }, 0);
  
  // 阻止冒泡，防止点击事件触发
  e.stopPropagation();
}

// 拖拽悬停处理
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

// 拖拽进入
function handleDragEnter(e) {
  this.classList.add('drag-over');
}

// 拖拽离开
function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

// 拖拽放置
function handleDrop(e) {
  e.stopPropagation();
  
  // 如果不是拖到自己身上
  if (draggedItem !== this) {
    // 获取所有存储桶项
    const items = Array.from($bucketList.querySelectorAll('.bucket-item'));
    // 获取当前项和目标项的索引
    const fromIndex = items.indexOf(draggedItem);
    const toIndex = items.indexOf(this);
    
    // 如果是向下拖，则插入到目标的后面，否则插入到目标的前面
    if (fromIndex < toIndex) {
      $bucketList.insertBefore(draggedItem, this.nextSibling);
    } else {
      $bucketList.insertBefore(draggedItem, this);
    }
    
    // 保存新的顺序
    saveBucketOrder();
  }
  
  // 移除样式
  this.classList.remove('drag-over');
  return false;
}

// 拖拽结束
function handleDragEnd(e) {
  // 移除所有样式
  const items = document.querySelectorAll('.bucket-item');
  items.forEach(item => {
    item.classList.remove('dragging');
    item.classList.remove('drag-over');
  });
}

// 保存存储桶顺序
function saveBucketOrder() {
  const items = Array.from($bucketList.querySelectorAll('.bucket-item'));
  const bucketNames = items.map(item => item.dataset.name);
  
  // 保存到数据库
  window.s3.saveBucketOrder(bucketNames);
}

// 侧边栏折叠/展开
function toggleSidebar() {
  const container = document.querySelector('.container');
  const sidebar = document.querySelector('.sidebar');
  const toggleIcon = document.querySelector('.toggle-icon');
  
  container.classList.toggle('sidebar-collapsed');
  sidebar.classList.toggle('collapsed');
  
  // 保存状态到本地存储
  const isCollapsed = container.classList.contains('sidebar-collapsed');
  localStorage.setItem('sidebar-collapsed', isCollapsed);
  
  // 更新图标
  toggleIcon.textContent = isCollapsed ? '▶' : '◀';
}

// 加载侧边栏状态
function loadSidebarState() {
  const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  
  if (isCollapsed) {
    const container = document.querySelector('.container');
    const sidebar = document.querySelector('.sidebar');
    const toggleIcon = document.querySelector('.toggle-icon');
    
    container.classList.add('sidebar-collapsed');
    sidebar.classList.add('collapsed');
    toggleIcon.textContent = '▶';
  }
}

// 选择存储桶
async function selectBucket(bucketName) {
  // 更新UI选中状态
  document.querySelectorAll('.bucket-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.name === bucketName) {
      item.classList.add('active');
    }
  });
  
  currentBucket = bucketName;
  currentPrefix = '';
  
  await loadObjects(bucketName, '');
  updatePathNavigation();
}

// 加载对象
async function loadObjects(bucket, prefix) {
  showLoading();
  try {
    const result = await window.s3.listObjects(bucket, prefix);
    currentObjects = result;
    renderObjectList(result);
    hideLoading();
    
    const totalObjects = (result.contents || []).length + (result.commonPrefixes || []).length;
    updateStatusBar(`${bucket}/${prefix} - ${totalObjects} 个项目`, '');
  } catch (error) {
    hideLoading();
    showNotification('加载对象失败: ' + error.message, 'error');
  }
}

// 渲染对象列表
function renderObjectList(result) {
  $fileList.innerHTML = '';
  
  const contents = result.contents || [];
  const commonPrefixes = result.commonPrefixes || [];
  
  if (contents.length === 0 && commonPrefixes.length === 0) {
    $fileList.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">此位置没有文件</div><button class="btn btn-primary" id="empty-upload-btn">上传文件</button></div>';
    
    // 添加空文件夹上传按钮点击事件
    document.getElementById('empty-upload-btn').addEventListener('click', () => showUploadModal());
    return;
  }
  
  // 添加返回上一级目录选项
  if (currentPrefix) {
    const backItem = document.createElement('li');
    backItem.className = 'file-item back-item';
    backItem.innerHTML = `
      <span class="file-icon folder">↩️</span>
      <div class="file-details">
        <span class="file-name">返回上级目录</span>
        <div class="file-meta"></div>
      </div>
    `;
    
    backItem.addEventListener('click', () => {
      navigateUp();
    });
    
    $fileList.appendChild(backItem);
  }
  
  // 渲染文件夹
  commonPrefixes.forEach(prefix => {
    const folderName = prefix.Prefix.substring(currentPrefix.length);
    const folderNameWithoutSlash = folderName.endsWith('/') ? folderName.slice(0, -1) : folderName;
    
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.type = 'folder';
    li.dataset.prefix = prefix.Prefix;
    
    li.innerHTML = `
      <span class="file-icon folder">📁</span>
      <div class="file-details">
        <span class="file-name">${folderNameWithoutSlash}</span>
        <div class="file-meta"></div>
      </div>
    `;
    
    li.addEventListener('click', () => {
      navigateToFolder(prefix.Prefix);
    });
    
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, li, 'folder');
    });
    
    $fileList.appendChild(li);
  });
  
  // 渲染文件
  contents.forEach(item => {
    // 跳过文件夹标记文件(以/结尾的对象)
    if (item.Key.endsWith('/') && item.Key !== currentPrefix) return;
    if (item.Key === currentPrefix) return;
    
    const fileName = item.Key.substring(currentPrefix.length);
    if (!fileName) return;
    
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.type = 'file';
    li.dataset.key = item.Key;
    li.dataset.size = item.Size;
    
    const formattedSize = formatFileSize(item.Size);
    const formattedDate = new Date(item.LastModified).toLocaleString();
    const fileIcon = getFileIcon(fileName);
    
    // 检查文件是否可预览
    const previewType = isPreviewable(fileName);
    if (previewType) {
      li.classList.add('previewable');
      li.dataset.previewType = previewType;
    }
    
    li.innerHTML = `
      <span class="file-icon file">${fileIcon}</span>
      <div class="file-details">
        <span class="file-name">${fileName}</span>
        <div class="file-meta">
          <span class="file-size">${formattedSize}</span>
          <span class="file-date">${formattedDate}</span>
        </div>
      </div>
    `;
    
    // 对可预览文件添加单击预览事件
    if (previewType) {
      li.addEventListener('click', () => {
        previewFile(item.Key, fileName, previewType);
      });
    } else {
      // 对不可预览文件保留双击下载行为
      li.addEventListener('dblclick', () => {
        downloadFile(item.Key);
      });
    }
    
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, li, 'file');
    });
    
    $fileList.appendChild(li);
  });
}

// 导航到文件夹
async function navigateToFolder(prefix) {
  // 添加视觉效果
  fadeOut($fileList, async () => {
    currentPrefix = prefix;
    await loadObjects(currentBucket, currentPrefix);
    updatePathNavigation();
    fadeIn($fileList);
  });
}

// 淡出效果
function fadeOut(element, callback) {
  element.style.opacity = '1';
  element.style.transition = 'opacity 0.3s ease';
  element.style.opacity = '0';
  
  setTimeout(() => {
    if (callback) callback();
  }, 300);
}

// 淡入效果
function fadeIn(element) {
  setTimeout(() => {
    element.style.opacity = '1';
  }, 50);
}

// 返回上级目录
async function navigateUp() {
  if (!currentPrefix) return;
  
  // 添加视觉效果
  fadeOut($fileList, async () => {
    // 移除当前前缀最后一个路径段
    const segments = currentPrefix.split('/');
    segments.pop(); // 移除空字符串
    if (segments.length > 0) {
      segments.pop(); // 移除上一级目录名
    }
    currentPrefix = segments.length > 0 ? segments.join('/') + '/' : '';
    
    await loadObjects(currentBucket, currentPrefix);
    updatePathNavigation();
    fadeIn($fileList);
  });
}

// 更新路径导航
function updatePathNavigation() {
  $pathNavigation.innerHTML = '';
  
  // 添加根目录
  const rootSegment = document.createElement('span');
  rootSegment.className = 'path-segment';
  rootSegment.innerHTML = `<span style="margin-right: 4px;">📦</span> ${currentBucket || 'S3'}`;
  rootSegment.addEventListener('click', () => {
    if (currentBucket) {
      currentPrefix = '';
      loadObjects(currentBucket, currentPrefix);
      updatePathNavigation();
    }
  });
  $pathNavigation.appendChild(rootSegment);
  
  // 只有在有子目录时才显示路径分隔符
  if (currentPrefix) {
    // 将当前前缀分割成路径段
    const segments = currentPrefix.split('/').filter(s => s);
    
    if (segments.length > 0) {
      $pathNavigation.appendChild(document.createTextNode(' / '));
      
      segments.forEach((segment, index) => {
        const pathSegment = document.createElement('span');
        pathSegment.className = 'path-segment';
        pathSegment.textContent = segment;
        
        // 计算到此段的路径
        const pathToSegment = segments.slice(0, index + 1).join('/') + '/';
        
        pathSegment.addEventListener('click', () => {
          currentPrefix = pathToSegment;
          loadObjects(currentBucket, currentPrefix);
          updatePathNavigation();
        });
        
        $pathNavigation.appendChild(pathSegment);
        
        // 添加路径分隔符
        if (index < segments.length - 1) {
          $pathNavigation.appendChild(document.createTextNode(' / '));
        }
      });
    }
  }
}

// 下载文件
async function downloadFile(key) {
  showLoading('正在下载文件...');
  try {
    const fileName = key.split('/').pop();
    const downloadPath = window.s3.getDownloadPath();
    const fullPath = `${downloadPath}/${fileName}`;
    
    await window.s3.downloadObject(currentBucket, key, fullPath);
    
    hideLoading();
    showNotification(`文件已下载到: ${fullPath}`, 'success');
    
    // 在资源管理器中显示该文件
    utools.shellShowItemInFolder(fullPath);
  } catch (error) {
    hideLoading();
    showNotification('下载文件失败: ' + error.message, 'error');
  }
}

// 处理文件上传
async function handleFileUpload(e) {
  e.preventDefault();
  
  if (!currentBucket) {
    showNotification('请先选择一个存储桶', 'warning');
    return;
  }
  
  const fileInput = document.getElementById('upload-files');
  const files = fileInput.files;
  
  if (files.length === 0) {
    showNotification('请选择要上传的文件', 'warning');
    return;
  }
  
  showLoading('正在上传文件...');
  isUploading = true;
  
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      updateStatusBar(`正在上传: ${file.name} (${i+1}/${files.length})`, '');
      
      const key = currentPrefix + file.name;
      const contentType = window.s3.getContentType(file.path);
      
      await window.s3.uploadObject(currentBucket, key, file.path, contentType);
    }
    
    hideLoading();
    isUploading = false;
    hideAllModals();
    
    // 刷新当前视图
    await loadObjects(currentBucket, currentPrefix);
    
    showNotification(`成功上传 ${files.length} 个文件`, 'success');
  } catch (error) {
    hideLoading();
    isUploading = false;
    showNotification('上传文件失败: ' + error.message, 'error');
  }
}

// 处理创建文件夹
async function handleCreateFolder(e) {
  e.preventDefault();
  
  if (!currentBucket) {
    showNotification('请先选择一个存储桶', 'warning');
    return;
  }
  
  const folderNameInput = document.getElementById('folder-name');
  let folderName = folderNameInput.value.trim();
  
  if (!folderName) {
    showNotification('请输入文件夹名称', 'warning');
    return;
  }
  
  // 确保文件夹名以/结尾
  if (!folderName.endsWith('/')) {
    folderName += '/';
  }
  
  const key = currentPrefix + folderName;
  
  showLoading('正在创建文件夹...');
  try {
    // 使用createEmptyFolder函数创建文件夹
    await window.s3.createEmptyFolder(currentBucket, key);
    
    hideLoading();
    hideAllModals();
    
    // 刷新当前视图
    await loadObjects(currentBucket, currentPrefix);
    
    showNotification(`成功创建文件夹: ${folderName}`, 'success');
  } catch (error) {
    hideLoading();
    showNotification('创建文件夹失败: ' + error.message, 'error');
  }
}

// 删除对象
async function deleteObject(key, type) {
  const confirmMessage = type === 'folder' 
    ? '确定要删除此文件夹及其内容吗?' 
    : '确定要删除此文件吗?';
    
  if (!confirm(confirmMessage)) {
    return;
  }
  
  showLoading('正在删除...');
  try {
    await window.s3.deleteObject(currentBucket, key);
    
    hideLoading();
    
    // 刷新当前视图
    await loadObjects(currentBucket, currentPrefix);
    
    showNotification(`成功删除${type === 'folder' ? '文件夹' : '文件'}`, 'success');
  } catch (error) {
    hideLoading();
    showNotification('删除失败: ' + error.message, 'error');
  }
}

// 重命名/移动对象
async function moveObject(sourceKey, type) {
  const newName = prompt(type === 'folder' ? '输入新的文件夹名称:' : '输入新的文件名:', 
    sourceKey.substring(currentPrefix.length));
  
  if (!newName || newName === sourceKey.substring(currentPrefix.length)) {
    return;
  }
  
  const destinationKey = currentPrefix + newName;
  
  showLoading('正在处理...');
  try {
    await window.s3.moveObject(currentBucket, sourceKey, destinationKey);
    
    hideLoading();
    
    // 刷新当前视图
    await loadObjects(currentBucket, currentPrefix);
    
    showNotification(`成功重命名${type === 'folder' ? '文件夹' : '文件'}`, 'success');
  } catch (error) {
    hideLoading();
    showNotification('重命名失败: ' + error.message, 'error');
  }
}

// 显示上下文菜单
function showContextMenu(event, target, type) {
  contextMenuTarget = {
    element: target,
    type: type,
    key: target.dataset.key || target.dataset.prefix
  };
  
  $contextMenu.innerHTML = '';
  
  if (type === 'file') {
    // 获取文件名
    const fileName = target.querySelector('.file-name').textContent;
    
    // 检查文件是否可预览
    const previewOption = isPreviewable(fileName) ? `
      <div class="context-menu-item" data-action="preview">
        <span>👁️</span> 预览
      </div>
    ` : '';
    
    // 文件操作菜单
    $contextMenu.innerHTML = `
      ${previewOption}
      <div class="context-menu-item" data-action="download">
        <span>⬇️</span> 下载
      </div>
      <div class="context-menu-item" data-action="rename">
        <span>✏️</span> 重命名
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="delete">
        <span>🗑️</span> 删除
      </div>
    `;
  } else if (type === 'folder') {
    // 文件夹操作菜单
    $contextMenu.innerHTML = `
      <div class="context-menu-item" data-action="open">
        <span>📂</span> 打开
      </div>
      <div class="context-menu-item" data-action="rename">
        <span>✏️</span> 重命名
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="delete">
        <span>🗑️</span> 删除
      </div>
    `;
  }
  
  // 添加事件监听
  $contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', handleContextMenuAction);
  });
  
  // 定位菜单
  $contextMenu.style.left = `${event.pageX}px`;
  $contextMenu.style.top = `${event.pageY}px`;
  $contextMenu.style.display = 'block';
  
  // 添加出现动画
  $contextMenu.style.opacity = '0';
  $contextMenu.style.transform = 'scale(0.95)';
  
  setTimeout(() => {
    $contextMenu.style.transition = 'all 0.2s ease';
    $contextMenu.style.opacity = '1';
    $contextMenu.style.transform = 'scale(1)';
  }, 10);
}

// 处理上下文菜单操作
function handleContextMenuAction(e) {
  const action = e.currentTarget.dataset.action;
  
  if (!contextMenuTarget) return;
  
  const { type, key } = contextMenuTarget;
  
  switch (action) {
    case 'download':
      downloadFile(key);
      break;
    case 'open':
      navigateToFolder(key);
      break;
    case 'rename':
      moveObject(key, type);
      break;
    case 'delete':
      deleteObject(key, type);
      break;
    case 'preview':
      // 获取文件名和预览类型
      const fileName = contextMenuTarget.element.querySelector('.file-name').textContent;
      const previewType = isPreviewable(fileName);
      if (previewType) {
        previewFile(key, fileName, previewType);
      }
      break;
  }
  
  hideContextMenu();
}

// 隐藏上下文菜单
function hideContextMenu() {
  $contextMenu.style.opacity = '0';
  $contextMenu.style.transform = 'scale(0.95)';
  
  setTimeout(() => {
    $contextMenu.style.display = 'none';
    contextMenuTarget = null;
  }, 200);
}

// 保存S3配置
function saveConfiguration(e) {
  e.preventDefault();
  
  const accessKeyId = document.getElementById('access-key-id').value.trim();
  const secretAccessKey = document.getElementById('secret-access-key').value.trim();
  const region = document.getElementById('region').value.trim();
  const endpoint = document.getElementById('endpoint').value.trim();
  const downloadPath = document.getElementById('download-path').value.trim();
  const forcePathStyle = document.getElementById('force-path-style').checked;
  
  if (!accessKeyId || !secretAccessKey || !region || !endpoint) {
    showNotification('请填写必要的配置信息', 'warning');
    return;
  }
  
  const config = {
    accessKeyId,
    secretAccessKey,
    region,
    endpoint,
    downloadPath: downloadPath || undefined,
    forcePathStyle
  };
  
  try {
    window.s3.saveConfig(config);
    s3Config = config;
    initializeS3Client();
    hideAllModals();
    loadBuckets();
    
    showNotification('配置已保存', 'success');
  } catch (error) {
    showNotification('保存配置失败: ' + error.message, 'error');
  }
}

// 刷新当前视图
async function refreshCurrentView() {
  if (currentBucket) {
    await loadObjects(currentBucket, currentPrefix);
  } else {
    await loadBuckets();
  }
}

// 显示加载中遮罩
function showLoading(message = '正在加载...') {
  const messageEl = $loadingOverlay.querySelector('div:not(.spinner)');
  if (messageEl) {
    messageEl.textContent = message;
  }
  
  $loadingOverlay.style.display = 'flex';
}

// 隐藏加载中遮罩
function hideLoading() {
  $loadingOverlay.style.display = 'none';
}

// 显示配置模态框
function showConfigModal() {
  hideAllModals();
  
  // 如果有保存的配置，填充表单
  if (s3Config) {
    document.getElementById('access-key-id').value = s3Config.accessKeyId || '';
    document.getElementById('secret-access-key').value = s3Config.secretAccessKey || '';
    document.getElementById('region').value = s3Config.region || '';
    document.getElementById('endpoint').value = s3Config.endpoint || '';
    document.getElementById('download-path').value = s3Config.downloadPath || '';
    document.getElementById('force-path-style').checked = s3Config.forcePathStyle || false;
  }
  
  $configModal.style.display = 'flex';
}

// 显示上传模态框
function showUploadModal() {
  if (!currentBucket) {
    showNotification('请先选择一个存储桶', 'warning');
    return;
  }
  
  hideAllModals();
  document.getElementById('upload-modal').style.display = 'flex';
  
  // 清除之前的文件选择
  document.getElementById('upload-files').value = '';
  const previewDiv = document.getElementById('file-preview');
  if (previewDiv) {
    previewDiv.remove();
  }
}

// 显示新建文件夹模态框
function showNewFolderModal() {
  if (!currentBucket) {
    showNotification('请先选择一个存储桶', 'warning');
    return;
  }
  
  hideAllModals();
  document.getElementById('new-folder-modal').style.display = 'flex';
  document.getElementById('folder-name').value = '';
  
  // 添加动画效果
  const modal = document.querySelector('#new-folder-modal .modal');
  modal.style.transform = 'translateY(20px)';
  modal.style.opacity = '0';
  
  setTimeout(() => {
    modal.style.transition = 'all 0.3s ease';
    modal.style.transform = 'translateY(0)';
    modal.style.opacity = '1';
    
    // 自动聚焦输入框
    document.getElementById('folder-name').focus();
  }, 10);
}

// 工作空间相关函数
// 显示工作空间模态框
function showWorkspaceModal() {
  hideAllModals();
  
  const workspaces = window.s3.getAllWorkspaces();
  renderWorkspaceList(workspaces);
  
  $workspaceModal.style.display = 'flex';
}

// 渲染工作空间列表
function renderWorkspaceList(workspaces) {
  $workspaceList.innerHTML = '';
  
  if (workspaces.length === 0) {
    $workspaceList.innerHTML = '<div class="empty-state"><div class="empty-text">没有工作空间</div></div>';
    return;
  }
  
  const currentWorkspaceId = window.s3.getCurrentWorkspaceId();
  
  workspaces.forEach(workspace => {
    const li = document.createElement('li');
    li.className = 'workspace-item';
    if (workspace.id === currentWorkspaceId) {
      li.classList.add('active');
    }
    
    const configStatus = workspace.config ? '已配置' : '未配置';
    
    li.innerHTML = `
      <div class="workspace-name">${workspace.name}</div>
      <div class="workspace-item-info">
        <div class="workspace-meta">
          <span class="workspace-status">${configStatus}</span>
          <button class="workspace-btn edit" title="编辑">✏️</button>
        </div>
      </div>
    `;
    
    // 点击切换工作空间
    li.addEventListener('click', (e) => {
      if (!e.target.closest('.workspace-btn')) {
        switchWorkspace(workspace.id);
      }
    });
    
    // 编辑按钮点击事件
    const editBtn = li.querySelector('.workspace-btn.edit');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditWorkspaceModal(workspace);
    });
    
    $workspaceList.appendChild(li);
  });
}

// 切换工作空间
function switchWorkspace(workspaceId) {
  window.s3.setCurrentWorkspaceId(workspaceId);
  loadCurrentWorkspace();
  hideAllModals();
  
  // 重置应用状态
  currentBucket = null;
  currentPrefix = '';
  $fileList.innerHTML = '';
  
  showNotification('已切换工作空间', 'info');
}

// 显示新建工作空间模态框
function showNewWorkspaceModal() {
  hideAllModals();
  document.getElementById('new-workspace-modal').style.display = 'flex';
  document.getElementById('workspace-name').value = '';
  document.getElementById('workspace-name').focus();
}

// 处理创建工作空间
function handleCreateWorkspace(e) {
  e.preventDefault();
  
  const name = document.getElementById('workspace-name').value.trim();
  if (!name) {
    showNotification('请输入工作空间名称', 'warning');
    return;
  }
  
  try {
    const workspace = window.s3.createWorkspace(name);
    
    // 如果这是第一个工作空间，自动切换到它
    if (window.s3.getAllWorkspaces().length === 1) {
      window.s3.setCurrentWorkspaceId(workspace.id);
    }
    
    hideAllModals();
    showWorkspaceModal();
    showNotification(`已创建工作空间 "${name}"`, 'success');
  } catch (error) {
    showNotification('创建工作空间失败: ' + error.message, 'error');
  }
}

// 显示编辑工作空间模态框
function showEditWorkspaceModal(workspace) {
  hideAllModals();
  
  document.getElementById('edit-workspace-id').value = workspace.id;
  document.getElementById('edit-workspace-name').value = workspace.name;
  
  document.getElementById('edit-workspace-modal').style.display = 'flex';
  document.getElementById('edit-workspace-name').focus();
}

// 处理编辑工作空间
function handleEditWorkspace(e) {
  e.preventDefault();
  
  const id = document.getElementById('edit-workspace-id').value;
  const name = document.getElementById('edit-workspace-name').value.trim();
  
  if (!name) {
    showNotification('请输入工作空间名称', 'warning');
    return;
  }
  
  try {
    const workspace = window.s3.getWorkspaceById(id);
    workspace.name = name;
    window.s3.saveWorkspace(workspace);
    
    // 如果编辑的是当前工作空间，更新标题
    if (id === window.s3.getCurrentWorkspaceId()) {
      $currentWorkspace.textContent = name;
      currentWorkspace = window.s3.getCurrentWorkspace();
    }
    
    hideAllModals();
    showWorkspaceModal();
    showNotification('工作空间已更新', 'success');
  } catch (error) {
    showNotification('更新工作空间失败: ' + error.message, 'error');
  }
}

// 处理删除工作空间
function handleDeleteWorkspace() {
  const id = document.getElementById('edit-workspace-id').value;
  const name = document.getElementById('edit-workspace-name').value;
  
  if (window.s3.getAllWorkspaces().length <= 1) {
    showNotification('不能删除唯一的工作空间', 'warning');
    return;
  }
  
  if (confirm(`确定要删除工作空间 "${name}" 吗？此操作不可撤销。`)) {
    try {
      window.s3.deleteWorkspace(id);
      
      hideAllModals();
      
      // 如果删除的是当前工作空间，会自动切换到其他工作空间
      if (id === window.s3.getCurrentWorkspaceId()) {
        loadCurrentWorkspace();
      }
      
      showWorkspaceModal();
      showNotification(`已删除工作空间 "${name}"`, 'info');
    } catch (error) {
      showNotification('删除工作空间失败: ' + error.message, 'error');
    }
  }
}

// 隐藏所有模态框
function hideAllModals() {
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => {
    const modalContent = modal.querySelector('.modal');
    
    // 添加关闭动画
    if (modalContent && modal.style.display !== 'none') {
      modalContent.style.transition = 'all 0.2s ease';
      modalContent.style.transform = 'translateY(20px)';
      modalContent.style.opacity = '0';
      
      setTimeout(() => {
        modal.style.display = 'none';
        // 重置样式，以便下次打开
        modalContent.style.transform = '';
        modalContent.style.opacity = '';
        
        // 如果是预览模态框，清理资源
        if (modal.id === 'preview-modal') {
          $previewContent.innerHTML = '';
          currentPreviewUrl = null;
          currentPreviewFile = null;
        }
      }, 200);
    } else {
      modal.style.display = 'none';
      
      // 如果是预览模态框，立即清理资源
      if (modal.id === 'preview-modal') {
        $previewContent.innerHTML = '';
        currentPreviewUrl = null;
        currentPreviewFile = null;
      }
    }
  });
}

// 显示通知
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  let icon = '💬';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  notification.innerHTML = `
    <span>${icon}</span>
    <span>${message}</span>
  `;
  
  document.body.appendChild(notification);
  
  // 2秒后自动移除
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    
    // 动画结束后移除元素
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// 更新状态栏
function updateStatusBar(leftText, rightText) {
  $statusText.textContent = leftText;
  $statusRight.textContent = rightText;
}

// 格式化文件大小
function formatFileSize(size) {
  if (size === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  
  return parseFloat((size / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}

// 获取文件图标
function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  
  // 根据扩展名返回适当的图标
  const iconMap = {
    pdf: '📄',
    doc: '📄',
    docx: '📄',
    xls: '📊',
    xlsx: '📊',
    ppt: '📊',
    pptx: '📊',
    jpg: '🖼️',
    jpeg: '🖼️',
    png: '🖼️',
    gif: '🖼️',
    svg: '🖼️',
    mp3: '🎵',
    wav: '🎵',
    mp4: '🎬',
    avi: '🎬',
    mkv: '🎬',
    mov: '🎬',
    zip: '📦',
    rar: '📦',
    tar: '📦',
    gz: '📦',
    txt: '📝',
    html: '📝',
    htm: '📝',
    js: '📝',
    json: '📝',
    css: '📝',
    csv: '📝',
    xml: '📝'
  };
  
  return iconMap[ext] || '📄';
}

// 检查文件是否可预览
function isPreviewable(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  
  // 可预览的文件类型
  const previewableTypes = {
    // 图片类型
    'jpg': 'image',
    'jpeg': 'image',
    'png': 'image',
    'gif': 'image',
    'webp': 'image',
    'svg': 'image',
    'bmp': 'image',
    
    // 视频类型
    'mp4': 'video',
    'webm': 'video',
    'ogg': 'video',
    'mov': 'video'
  };
  
  return previewableTypes[ext] || false;
}

// 处理退出插件前的清理
window.addEventListener('beforeunload', () => {
  // 如果正在上传文件，提示用户
  if (isUploading) {
    return '正在上传文件，确定要离开吗?';
  }
});

// 预览文件
async function previewFile(key, fileName, previewType) {
  // 更新全局状态
  currentPreviewFile = key;
  $previewTitle.textContent = fileName;
  $previewContent.innerHTML = '<div class="preview-loading">正在准备预览，请稍候...</div>'; 
  
  showLoading('正在获取预览内容...');
  
  try {
    console.log(`正在获取预览URL，bucket: ${currentBucket}, key: ${key}`);
    
    // 显示预览模态框，先显示空内容，避免用户等待
    hideAllModals();
    $previewModal.style.display = 'flex';
    
    // 获取预览URL
    const url = await window.s3.getObjectPreviewUrl(currentBucket, key);
    currentPreviewUrl = url;
    
    console.log(`已获取预览URL，类型: ${previewType}`);
    $previewContent.innerHTML = ''; // 清空预览内容
    
    // 根据类型显示不同预览
    if (previewType === 'image') {
      // 创建一个错误处理函数，可以在不同地方重用
      const handleError = (e) => {
        console.error('图片加载失败:', e);
        hideLoading();
        $previewContent.innerHTML = '<div class="preview-error">图片加载失败，可能是网络问题或CORS策略限制。</div>';
        showNotification('图片预览加载失败，请检查网络连接和对象权限', 'error');
      };
      
      const img = document.createElement('img');
      
      // 添加图片加载事件
      img.onload = () => {
        console.log('图片已加载完成');
        hideLoading();
      };
      
      img.onerror = handleError;
      
      // 添加加载中状态
      const loadingIndicator = document.createElement('div');
      loadingIndicator.className = 'preview-loading-indicator';
      loadingIndicator.textContent = '加载图片中...';
      $previewContent.appendChild(loadingIndicator);
      
      // 设置图片属性并添加到DOM
      img.alt = fileName;
      img.crossOrigin = 'anonymous'; // 尝试处理CORS问题
      img.src = url;
      
      $previewContent.appendChild(img);
      
      // 如果3秒后图片还未加载完成，检查
      setTimeout(() => {
        if (img.complete) {
          if (loadingIndicator.parentNode) {
            loadingIndicator.remove();
          }
        } else {
          console.log('图片加载时间较长...');
        }
      }, 3000);
      
    } else if (previewType === 'video') {
      const video = document.createElement('video');
      
      // 设置视频属性
      video.controls = true;
      video.autoplay = false;
      video.crossOrigin = 'anonymous'; // 尝试处理CORS问题
      
      // 添加加载状态提示
      const videoLoadingIndicator = document.createElement('div');
      videoLoadingIndicator.className = 'preview-loading-indicator';
      videoLoadingIndicator.textContent = '加载视频中...';
      $previewContent.appendChild(videoLoadingIndicator);
      
      // 添加视频元数据加载事件
      video.onloadedmetadata = () => {
        console.log('视频元数据已加载');
        if (videoLoadingIndicator.parentNode) {
          videoLoadingIndicator.remove();
        }
        hideLoading();
      };
      
      video.onerror = (e) => {
        console.error('视频加载失败:', e);
        hideLoading();
        $previewContent.innerHTML = '<div class="preview-error">视频加载失败，可能是网络问题或CORS策略限制。</div>';
        showNotification('视频预览加载失败，请检查网络连接和对象权限', 'error');
      };
      
      video.src = url;
      
      $previewContent.appendChild(video);
    }
    
    // 如果5秒后仍未加载完，隐藏加载遮罩（避免加载卡住）
    setTimeout(() => {
      if ($loadingOverlay.style.display !== 'none') {
        console.log('预览加载超时，强制隐藏加载状态');
        hideLoading();
        showNotification('预览加载时间较长，请耐心等待', 'info');
      }
    }, 5000);
    
  } catch (error) {
    console.error('预览文件失败:', error);
    hideLoading();
    
    // 更新模态框内容，显示错误信息
    $previewContent.innerHTML = `<div class="preview-error">
      <p>预览加载失败</p>
      <p class="preview-error-details">${error.message}</p>
      <button class="btn btn-primary preview-download-btn">下载文件</button>
    </div>`;
    
    // 为错误页面中的下载按钮添加事件
    const downloadBtn = $previewContent.querySelector('.preview-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        downloadFile(key);
      });
    }
    
    showNotification(`预览文件失败: ${error.message}`, 'error');
  }
} 