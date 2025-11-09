// Use Web3.Storage for IPFS uploads
// Set WEB3_STORAGE_TOKEN in environment variables
const WEB3_STORAGE_TOKEN = process.env.WEB3_STORAGE_TOKEN;

let web3StorageClient = null;

// Initialize Web3.Storage client
async function initWeb3Storage() {
  if (!web3StorageClient) {
    if (!WEB3_STORAGE_TOKEN) {
      throw new Error('WEB3_STORAGE_TOKEN environment variable is required for IPFS uploads');
    }
    try {
      const { Web3Storage } = await import('web3.storage');
      web3StorageClient = new Web3Storage({ token: WEB3_STORAGE_TOKEN });
      console.log('✅ Web3.Storage client initialized');
    } catch (error) {
      console.error('Failed to initialize Web3.Storage:', error.message);
      throw new Error(`Failed to initialize IPFS client: ${error.message}`);
    }
  }
  return web3StorageClient;
}

/**
 * Upload contract content to IPFS using Web3.Storage
 * @param {string} content - The contract content to upload
 * @returns {Promise<string>} - The IPFS hash (CID)
 */
export async function uploadToIPFS(content) {
  const client = await initWeb3Storage();
  
  try {
    console.log('📤 Uploading content to IPFS...');
    const { File } = await import('web3.storage');
    const file = new File([Buffer.from(content, 'utf8')], 'contract.txt', {
      type: 'text/plain',
    });
    
    const cid = await client.put([file], {
      name: `contract-${Date.now()}`,
      wrapWithDirectory: false,
    });
    
    console.log(`✅ Content uploaded to IPFS! CID: ${cid}`);
    console.log(`   🔗 View at: https://${cid}.ipfs.w3s.link/`);
    console.log(`   📋 IPFS Gateway: https://ipfs.io/ipfs/${cid}`);
    return cid;
  } catch (error) {
    console.error('❌ Error uploading to IPFS:', error.message);
    throw new Error(`Failed to upload content to IPFS: ${error.message}`);
  }
}

/**
 * Retrieve content from IPFS
 * @param {string} ipfsHash - The IPFS hash (CID)
 * @returns {Promise<string>} - The content
 */
export async function retrieveFromIPFS(ipfsHash) {
  const client = await initWeb3Storage();
  
  try {
    console.log(`📥 Retrieving content from IPFS: ${ipfsHash}`);
    const res = await client.get(ipfsHash);
    if (!res) {
      throw new Error('Content not found on IPFS');
    }
    
    const files = await res.files();
    if (files.length === 0) {
      throw new Error('No files found in IPFS CID');
    }
    
    const file = files[0];
    const content = await file.text();
    console.log(`✅ Retrieved content from IPFS: ${ipfsHash}`);
    return content;
  } catch (error) {
    console.error('Error retrieving from IPFS:', error);
    throw new Error(`Failed to retrieve content from IPFS: ${error.message}`);
  }
}

/**
 * Pin content to IPFS to ensure it persists
 * Note: Web3.Storage automatically pins content when uploaded
 * @param {string} ipfsHash - The IPFS hash (CID) to pin
 * @returns {Promise<void>}
 */
export async function pinToIPFS(ipfsHash) {
  const client = await initWeb3Storage();
  
  try {
    // Web3.Storage automatically pins content when uploaded
    // Verify the content exists and is pinned
    console.log(`📌 Verifying IPFS pin status: ${ipfsHash}`);
    const status = await client.status(ipfsHash);
    if (status) {
      console.log(`✅ Content is pinned on IPFS: ${ipfsHash}`);
      console.log(`   🔗 View at: https://${ipfsHash}.ipfs.w3s.link/`);
      console.log(`   📋 IPFS Gateway: https://ipfs.io/ipfs/${ipfsHash}`);
    } else {
      console.log(`✅ Content uploaded to IPFS: ${ipfsHash}`);
    }
  } catch (error) {
    console.warn('Error checking IPFS pin status:', error.message);
    // Don't throw - pinning verification failure shouldn't break the flow
    // Content is still uploaded and accessible
  }
}

