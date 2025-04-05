const { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 存储配置的数据库ID
const CONFIG_DB_ID = 's3_config';
// 工作空间配置ID
const WORKSPACES_DB_ID = 's3_workspaces';
const CURRENT_WORKSPACE_ID = 's3_current_workspace';
// 存储桶排序ID
const BUCKET_ORDER_DB_ID = 's3_bucket_order';
// 默认下载路径
const DEFAULT_DOWNLOAD_PATH = path.join(os.homedir(), 'Downloads');
// 默认工作空间名称
const DEFAULT_WORKSPACE_NAME = '默认工作空间';

// S3客户端实例
let s3Client = null;

// 初始化S3客户端
function initS3Client(config) {
  const clientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  };
  
  // 如果有自定义终端节点
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle === undefined ? true : config.forcePathStyle;
  }
  
  s3Client = new S3Client(clientConfig);
  return s3Client;
}

// 获取所有存储桶
async function listBuckets() {
  try {
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);
    return response.Buckets || [];
  } catch (error) {
    console.error('获取存储桶列表失败:', error);
    throw error;
  }
}

// 列出存储桶中的对象
async function listObjects(bucket, prefix = '', continuationToken = null) {
  try {
    const params = {
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',  // 添加分隔符参数，用于区分文件夹和文件
      MaxKeys: 1000
    };
    
    if (continuationToken) {
      params.ContinuationToken = continuationToken;
    }
    
    const command = new ListObjectsV2Command(params);
    const response = await s3Client.send(command);
    
    // 处理文件夹结构
    const contents = response.Contents || [];
    const commonPrefixes = response.CommonPrefixes || [];
    const isTruncated = response.IsTruncated;
    const nextToken = response.NextContinuationToken;
    
    console.log(`列出对象: ${bucket}/${prefix}, 文件: ${contents.length}, 文件夹: ${commonPrefixes.length}`);
    
    return {
      contents,
      commonPrefixes,
      isTruncated,
      nextToken
    };
  } catch (error) {
    console.error(`列出对象失败 (bucket: ${bucket}, prefix: ${prefix}):`, error);
    throw error;
  }
}

// 下载对象
async function downloadObject(bucket, key, localPath) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    
    // 确保目录存在
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 使用流写入文件
    const writeStream = fs.createWriteStream(localPath);
    response.Body.pipe(writeStream);
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(localPath));
      writeStream.on('error', reject);
    });
  } catch (error) {
    console.error(`下载对象失败 (bucket: ${bucket}, key: ${key}):`, error);
    throw error;
  }
}

// 上传对象
async function uploadObject(bucket, key, filePath, contentType) {
  try {
    const fileContent = fs.readFileSync(filePath);
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType
    });
    
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error(`上传对象失败 (bucket: ${bucket}, key: ${key}):`, error);
    throw error;
  }
}

// 删除对象
async function deleteObject(bucket, key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error(`删除对象失败 (bucket: ${bucket}, key: ${key}):`, error);
    throw error;
  }
}

// 移动/重命名对象
async function moveObject(bucket, sourceKey, destinationKey) {
  try {
    // S3没有移动操作，需要先复制后删除
    const copyCommand = new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destinationKey
    });
    
    await s3Client.send(copyCommand);
    
    // 删除原始对象
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucket,
      Key: sourceKey
    });
    
    await s3Client.send(deleteCommand);
    return true;
  } catch (error) {
    console.error(`移动对象失败 (bucket: ${bucket}, from: ${sourceKey}, to: ${destinationKey}):`, error);
    throw error;
  }
}

// 保存配置
function saveConfig(config) {
  // 获取当前工作空间ID
  const workspaceId = getCurrentWorkspaceId();
  
  // 加密敏感信息
  const encryptedConfig = {
    ...config,
    accessKeyId: encrypt(config.accessKeyId),
    secretAccessKey: encrypt(config.secretAccessKey)
  };
  
  // 保存到工作空间
  const workspace = getWorkspaceById(workspaceId);
  if (workspace) {
    workspace.config = encryptedConfig;
    saveWorkspace(workspace);
  } else {
    // 如果找不到当前工作空间，创建一个新的默认工作空间
    const newWorkspace = {
      id: workspaceId || crypto.randomBytes(16).toString('hex'),
      name: DEFAULT_WORKSPACE_NAME,
      config: encryptedConfig
    };
    saveWorkspace(newWorkspace);
    setCurrentWorkspaceId(newWorkspace.id);
  }
  
  return encryptedConfig;
}

// 获取配置
function getConfig() {
  const workspaceId = getCurrentWorkspaceId();
  if (!workspaceId) return null;
  
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace || !workspace.config) return null;
  
  // 解密敏感信息
  return {
    ...workspace.config,
    accessKeyId: decrypt(workspace.config.accessKeyId),
    secretAccessKey: decrypt(workspace.config.secretAccessKey)
  };
}

// 删除配置
function deleteConfig() {
  const workspaceId = getCurrentWorkspaceId();
  if (workspaceId) {
    const workspace = getWorkspaceById(workspaceId);
    if (workspace) {
      delete workspace.config;
      saveWorkspace(workspace);
    }
  }
}

// 工作空间相关函数
// 获取所有工作空间
function getAllWorkspaces() {
  const workspaces = utools.dbStorage.getItem(WORKSPACES_DB_ID) || [];
  return workspaces.map(ws => ({
    ...ws,
    // 不返回敏感信息
    config: ws.config ? { ...ws.config, accessKeyId: '***', secretAccessKey: '***' } : null
  }));
}

// 根据ID获取工作空间
function getWorkspaceById(id) {
  const workspaces = utools.dbStorage.getItem(WORKSPACES_DB_ID) || [];
  return workspaces.find(ws => ws.id === id);
}

// 保存工作空间
function saveWorkspace(workspace) {
  let workspaces = utools.dbStorage.getItem(WORKSPACES_DB_ID) || [];
  const index = workspaces.findIndex(ws => ws.id === workspace.id);
  
  if (index >= 0) {
    workspaces[index] = workspace;
  } else {
    workspaces.push(workspace);
  }
  
  utools.dbStorage.setItem(WORKSPACES_DB_ID, workspaces);
  return workspace;
}

// 删除工作空间
function deleteWorkspace(id) {
  let workspaces = utools.dbStorage.getItem(WORKSPACES_DB_ID) || [];
  workspaces = workspaces.filter(ws => ws.id !== id);
  utools.dbStorage.setItem(WORKSPACES_DB_ID, workspaces);
  
  // 如果删除的是当前工作空间，重置当前工作空间ID
  if (getCurrentWorkspaceId() === id) {
    if (workspaces.length > 0) {
      setCurrentWorkspaceId(workspaces[0].id);
    } else {
      setCurrentWorkspaceId(null);
    }
  }
}

// 获取当前工作空间ID
function getCurrentWorkspaceId() {
  return utools.dbStorage.getItem(CURRENT_WORKSPACE_ID);
}

// 设置当前工作空间ID
function setCurrentWorkspaceId(id) {
  utools.dbStorage.setItem(CURRENT_WORKSPACE_ID, id);
  return id;
}

// 创建工作空间
function createWorkspace(name) {
  const id = crypto.randomBytes(16).toString('hex');
  const workspace = {
    id,
    name: name || `工作空间 ${new Date().toLocaleString()}`,
    config: null
  };
  
  saveWorkspace(workspace);
  
  // 如果这是第一个工作空间，将其设为当前工作空间
  if (getAllWorkspaces().length === 1) {
    setCurrentWorkspaceId(id);
  }
  
  return workspace;
}

// 初始化工作空间
function initWorkspaces() {
  // 检查是否存在旧配置（兼容旧版本）
  const oldConfig = utools.dbStorage.getItem(CONFIG_DB_ID);
  
  // 如果没有工作空间但有旧配置，迁移到默认工作空间
  if (oldConfig && (getAllWorkspaces().length === 0)) {
    const defaultWorkspace = {
      id: crypto.randomBytes(16).toString('hex'),
      name: DEFAULT_WORKSPACE_NAME,
      config: oldConfig
    };
    
    saveWorkspace(defaultWorkspace);
    setCurrentWorkspaceId(defaultWorkspace.id);
    
    // 可选：删除旧配置（或保留以防万一）
    // utools.dbStorage.removeItem(CONFIG_DB_ID);
  }
  
  // 如果没有工作空间也没有旧配置，创建一个空的默认工作空间
  if (getAllWorkspaces().length === 0) {
    const defaultWorkspace = createWorkspace(DEFAULT_WORKSPACE_NAME);
    setCurrentWorkspaceId(defaultWorkspace.id);
  }
  
  // 如果没有设置当前工作空间，设置第一个工作空间为当前工作空间
  if (!getCurrentWorkspaceId() && getAllWorkspaces().length > 0) {
    setCurrentWorkspaceId(getAllWorkspaces()[0].id);
  }
}

// 获取当前工作空间
function getCurrentWorkspace() {
  const id = getCurrentWorkspaceId();
  if (!id) return null;
  
  const workspace = getWorkspaceById(id);
  if (!workspace) return null;
  
  // 不返回敏感信息
  return {
    ...workspace,
    config: workspace.config ? { ...workspace.config, accessKeyId: '***', secretAccessKey: '***' } : null
  };
}

// 简单的加密函数
function encrypt(text) {
  // 实际应用中应该使用更安全的加密方式
  const cipher = crypto.createCipher('aes-256-cbc', 'utools-s3-plugin-key');
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// 简单的解密函数
function decrypt(encrypted) {
  try {
    const decipher = crypto.createDecipher('aes-256-cbc', 'utools-s3-plugin-key');
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('解密失败:', error);
    return '';
  }
}

// 从文件路径获取内容类型
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.xml': 'application/xml',
    '.csv': 'text/csv'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

// 获取下载路径
function getDownloadPath() {
  const config = getConfig();
  return (config && config.downloadPath) ? config.downloadPath : DEFAULT_DOWNLOAD_PATH;
}

// 获取工作空间的存储桶排序
function getBucketOrder(workspaceId) {
  if (!workspaceId) {
    workspaceId = getCurrentWorkspaceId();
  }
  
  // 获取全局排序配置
  const allBucketOrders = utools.dbStorage.getItem(BUCKET_ORDER_DB_ID) || {};
  
  // 返回指定工作空间的排序，如果不存在则返回空数组
  return allBucketOrders[workspaceId] || [];
}

// 保存工作空间的存储桶排序
function saveBucketOrder(bucketNames, workspaceId) {
  if (!workspaceId) {
    workspaceId = getCurrentWorkspaceId();
  }
  
  // 获取全局排序配置
  const allBucketOrders = utools.dbStorage.getItem(BUCKET_ORDER_DB_ID) || {};
  
  // 更新指定工作空间的排序
  allBucketOrders[workspaceId] = bucketNames;
  
  // 保存回数据库
  utools.dbStorage.setItem(BUCKET_ORDER_DB_ID, allBucketOrders);
  
  return bucketNames;
}

// 获取对象的预览URL
async function getObjectPreviewUrl(bucket, key) {
  try {
    // 确保客户端实例有效
    if (!s3Client) {
      throw new Error("S3客户端未初始化");
    }
    
    console.log(`正在生成预览URL: ${bucket}/${key}`);
    
    // 创建指向对象的命令
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    // 生成预签名URL，有效期24小时
    const url = await getSignedUrl(s3Client, command, { 
      expiresIn: 86400  // 24小时
    });
    
    // 截取URL的前50个字符用于日志
    const shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
    console.log(`成功生成预览URL: ${shortUrl}`);
    
    return url;
  } catch (error) {
    console.error(`获取对象预览URL失败: ${error.message}`);
    console.error(error.stack);
    
    // 检查是否是网络或权限问题
    if (error.name === 'NetworkError' || error.name === 'AccessDenied') {
      throw new Error(`访问被拒绝或网络错误: ${error.message}`);
    }
    
    // 返回更友好的错误消息
    throw new Error(`无法生成预览URL: ${error.message}`);
  }
}

// 创建空文件夹
async function createEmptyFolder(bucket, key) {
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '',  // 空字符串代替Buffer
      ContentType: 'application/x-directory'
    });
    
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error(`创建文件夹失败 (bucket: ${bucket}, key: ${key}):`, error);
    throw error;
  }
}

// 初始化工作空间
initWorkspaces();

// 公开API
window.s3 = {
  initClient: initS3Client,
  listBuckets,
  listObjects,
  downloadObject,
  uploadObject,
  deleteObject,
  moveObject,
  saveConfig,
  getConfig,
  deleteConfig,
  getDownloadPath,
  getContentType,
  // 工作空间相关API
  getAllWorkspaces,
  getCurrentWorkspace,
  getCurrentWorkspaceId,
  setCurrentWorkspaceId,
  createWorkspace,
  saveWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  // 存储桶排序相关API
  getBucketOrder,
  saveBucketOrder,
  // 预览相关API
  getObjectPreviewUrl,
  // 文件夹操作
  createEmptyFolder
}; 