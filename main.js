const DEBUG = true;

const chokidar = require('chokidar');
const os = require('os');
const {spawn, exec} = require('child_process');
const {createClient} = require('@supabase/supabase-js');
const {v4: uuidv4} = require('uuid');
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require('node-cron');
const https = require('https');
const {randomUUID} = require("node:crypto");

const supabase = createClient('https://jfcurpgmlzlceotuthat.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmY3VycGdtbHpsY2VvdHV0aGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDUwODQ4ODksImV4cCI6MjAyMDY2MDg4OX0.7rAa3V9obXlEhewdRah4unY0apsEPHWEYXk5OwKYkLI');

// Get the correct path for appdata in the current OS
const appDataPath = process.env.APPDATA || (os.platform() == 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : '/var/local');
const nodeFolderPath = path.join(appDataPath, 'Node Server');

const defaultUserID = "38a93bd6-ec88-4b66-a17c-c43f4fc8bcc5";
let userID = "38a93bd6-ec88-4b66-a17c-c43f4fc8bcc5";

async function handleUpdate(installerUrl, installerPath) {
    const writer = fs.createWriteStream(installerPath);
    const downloadResponse = await axios({
        url: installerUrl,
        method: 'GET',
        responseType: 'stream'
    });

    downloadResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', () => {
            writer.close();  // Close the stream
        });
        writer.on('close', resolve);  // Resolve the promise on stream close
        writer.on('error', (error) => {
            console.error(`Error writing file: ${error}`);
            reject(error);
        });
    });

    console.log('Installer downloaded, starting the update process...');

    // Execute the installer
    exec(`"${installerPath}" /VERYSILENT`, (err) => {
        if (err) {
            console.error(`Error executing installer: ${err}`);
            return;
        }

        // Terminate the service
        process.exit(0);
    });
}

async function checkIfUpdate() {
    try {
        console.log("cur user: " + userID);
        const filePath = path.join(nodeFolderPath, 'version.txt');
        const curVersion = fs.readFileSync(filePath, 'utf8');
        let {data: server, error} = await supabase
            .from('servers')
            .select('owner_id, version')
            .eq('owner_id', userID)

        if (server.length > 0) {
            const expectedVersion = server[0].version;
            if (expectedVersion != null && expectedVersion != curVersion) {
                console.log("update required!");
                await getUpdate(expectedVersion)
            }
        }
    }
    catch {
        console.error("error checking for update");
    }
}

async function getUpdate(versionNumber) {
    try {
        const response = await axios.get('https://api.github.com/repos/proshkin/SkedAIServer/releases/tags/' + versionNumber);
        const installerUrl = response.data.assets[0].browser_download_url; // Assuming the installer is the first asset

        const versionFilePath = path.join(nodeFolderPath, 'version.txt');
        const filename = path.basename(new URL(installerUrl).pathname);
        const downloadPath = path.join(nodeFolderPath, filename);
        console.log("Update found!");
        handleUpdate(installerUrl, downloadPath)
    } catch (error) {
        console.error('Error updating:', error);
    }
}

async function checkForUpdates() {
    try {
        const response = await axios.get('https://api.github.com/repos/proshkin/SkedAIServer/releases/latest');
        // const response = await httpsGet('https://api.github.com/repos/proshkin/SkedAIServer/releases/latest');
        const latestVersion = response.data.tag_name;
        const installerUrl = response.data.assets[0].browser_download_url; // Assuming the installer is the first asset

        const versionFilePath = path.join(nodeFolderPath, 'version.txt');
        const currentVersion = fs.readFileSync(versionFilePath, 'utf8');
        // Compare with current version
        if (latestVersion !== currentVersion) {
            console.log('New version available:', latestVersion);
            console.log('URL', installerUrl);
            const filename = path.basename(new URL(installerUrl).pathname);
            const downloadPath = path.join(nodeFolderPath, filename);


            handleUpdate(installerUrl, downloadPath);

        } else {
            console.log('No updates found');
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}



// Define the path of the file to watch
const tokenFilePath = path.join(appDataPath, 'Node Server', 'token.txt');

// Initialize watcher
const watcher = chokidar.watch(tokenFilePath, {
    persistent: true,
    ignoreInitial: false
});

// Add event listeners
watcher
  .on('add', path => handleFileChange(path))
  .on('change', path => handleFileChange(path));

supabase.auth.onAuthStateChange((event, session) => {
    if (event == "TOKEN_REFRESHED") {
        writeRefreshedTokens(session.access_token, session.refresh_token);
    }
    // console.log(event, session);
})


// checkForUpdates();
cron.schedule('0 21 * * *', () => {
    console.log('Running scheduled update check...');
    checkIfUpdate();
});

async function handleFileChange(path) {
    // stopPythonScript;
    console.log(`File ${path} has been added or changed`);

    try {
        const data = fs.readFileSync(path, 'utf8');
        if (data.length === 0) {
            console.log(`File ${path} is empty. Stopping the service.`);
            process.exit(0);
        }

        let lastPeriodIndex = data.lastIndexOf('.');
        let accessToken = data.substring(0, lastPeriodIndex);
        let refreshToken = data.substring(lastPeriodIndex + 1);
        // console.log("Access Token: " + accessToken + "\nRefresh Token: " + refreshToken);

        try {
          let curUser = await authenticateUser(accessToken, refreshToken, supabase);
          checkIfUpdate();
          addServerIfNewUser();
          return curUser;
        } catch (error) {
          console.error('Authentication error:', error);
        }

    } catch (err) {
        console.error(`Error reading file ${path}:`, err);
    }

}

async function authenticateUser(accessToken, refreshToken) {
    try {
        const {session, error} = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        const user = session.user;
        userID = user.id;

        return user;
    } catch (error) {
        console.error(error);
    }
}

const addServerIfNewUser = async (localServerState) => {
    macAddress = localServerState.macAddress;
    ipAddress = localServerState.ipAddress;
    cpuCores = localServerState.cpuCores;

    const serverFilePath = path.join(nodeFolderPath, 'servers.txt');
    const prevServer = fs.readFileSync(serverFilePath, 'utf8');

    let {data: server, error} = await supabase
        .from('servers')
        .select('server_id')
        .eq('server_id', prevServer)

    if (error) {
        console.error('Error fetching servers:', error);
        return;
    }

    if (!server || server.length === 0) {
        let {error} = await supabase
            .from('servers')
            .insert([{
                server_id: randomUUID(),
                mac_address: macAddress,
                cpu_cores: cpuCores,
                ip_address: ipAddress,
                is_user_server: true,
                owner_id: userID,
                version: 0.1
            }]);

        if (error) {
            console.error('Error inserting server:', error);
        }
    }
}


async function writeRefreshedTokens(accessToken, refreshToken) {
    try {
        // ensure the directory exists
        // await fs.promises.mkdir(appDataPath, { recursive: true });
        const filePath = path.join(nodeFolderPath, 'token.txt');
        await fs.promises.writeFile(filePath, accessToken + '.' + refreshToken, {
            flag: 'w',
        });
        const filePath2 = path.join(appDataPath, 'cookie.txt');
        const content = fs.readFileSync(filePath2, { encoding: 'utf8' });
        let data = JSON.parse(content);
        data.access_token = accessToken;
        data.refresh_token = refreshToken;
        await fs.promises.writeFile(filePath2, JSON.stringify(data, null), {
            flag: 'w',
        });
    } catch (error) {
        console.error(error);
    }
}


const localServerState = {
    macAddress: null,
    ipAddress: null,
    cpuCores: null
}

function debugLog(msg) {
    if (DEBUG) {
        // log message with time stamp
        console.log(new Date().toLocaleString() + " " + msg);
    }
}

function retry(fn, timeout, maxRetries) {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        const tryCall = () => {
            fn()
                .then(resolve)
                .catch((error) => {
                    attempts += 1;

                    if (maxRetries === undefined || attempts < maxRetries) {
                        debugLog(`Retrying in ${timeout / 1000} seconds...`);
                        setTimeout(tryCall, timeout);
                    } else {
                        reject(new Error(`Failed after ${maxRetries} retries: ${error.message}`));
                    }
                });
        };

        tryCall();
    });
}

const getMACAddress = async () => {
    const interfaces = os.networkInterfaces();

    // check OS type
    if (os.type() === 'Darwin') {
        if (interfaces.en0?.[0]?.mac) {
            return interfaces.en0?.[0]?.mac;
        }
        throw new Error('MAC address not found for Darwin');
    } else if (os.type() === 'Windows_NT') {
        if (interfaces['Wi-Fi']?.[1]?.mac) {
            return interfaces['Wi-Fi']?.[1]?.mac;
        }
        throw new Error('MAC address not found for Windows_NT');
    } else {
        // Linux and other UNIX-like systems
        for (const [name, infos] of Object.entries(interfaces)) {
            if (name !== 'lo') {
                for (const info of infos) {
                    if (info.mac && info.mac !== '00:00:00:00:00:00') {
                        return info.mac;
                    }
                }
            }
        }
    }

    throw new Error('MAC address not found');
};

const getIPAddress = async () => {
    try {
        const interfaces = os.networkInterfaces();
        const osType = os.type();

        if (osType === 'Darwin') {
            for (const info of interfaces.en0 || []) {
                if (info.family === 'IPv4' && !info.internal) {
                    return info.address;
                }
            }
        } else if (osType === 'Windows_NT') {
            for (const [name, infos] of Object.entries(interfaces)) {
                if (name.includes('Wi-Fi') || name.includes('Ethernet')) {
                    for (const info of infos) {
                        if (info.family === 'IPv4' && !info.internal) {
                            return info.address;
                        }
                    }
                }
            }
        } else {
            // Linux and other UNIX-like systems
            for (const [name, infos] of Object.entries(interfaces)) {
                if (name !== 'lo') {
                    for (const info of infos) {
                        if (info.family === 'IPv4' && !info.internal) {
                            return info.address;
                        }
                    }
                }
            }
        }

        throw new Error('No IP address found');
    } catch (error) {
        console.error("An error occurred while getting the IP address:", error);
        throw error;
    }
};

// create a new uuid server_id
// const serverId = randomUUID();

// Check if MAC address exists in the list of servers and add if it does not then add it
const addServerIfAbsent = async (localServerState) => {
    macAddress = localServerState.macAddress;
    ipAddress = localServerState.ipAddress;
    cpuCores = localServerState.cpuCores;

    debugLog("Checking if server with MAC address " + macAddress + " exists");
    let {data: server, error} = await supabase
        .from('servers')
        .select('mac_address')
        .eq('mac_address', macAddress)

    if (error) {
        console.error('Error fetching servers:', error);
        return;
    }

    if (!server || server.length === 0) {
        let {error} = await supabase
            .from('servers')
            .insert([{
                mac_address: macAddress,
                cpu_cores: cpuCores,
                ip_address: ipAddress,
                is_user_server: true,
                owner_id: userID
            }]);

        if (error) {
            console.error('Error inserting server:', error);
        }
    }
}


//create a new solver queue class with some max size
class SolverQueue {
    constructor(solverId, maxSize) {
        this.solverId = solverId;
        this.maxSize = maxSize;
        this.runningQueue = [];
        this.pendingQueue = [];
        console.log("Solver queue created with solver_id: " + solverId + " and max size: " + maxSize);
    }

    enqueue(modelId) {
        // print current status of queue
        if (this.runningQueue.length < this.maxSize) {
            console.log("adding model to queue");
            // print current status of queue
            this.runningQueue.push(modelId);
            //check if queue is empty
            //if empty, run the solver
            //else, add to queue
            if (this.runningQueue.length === 1) {
                console.log("running model");
                // set status to running
                updateSolverQueueStatus(this.solverId, modelId, "running");
                updateModelStatus(modelId, "running");
                runCppScript(this.solverId, modelId, 30, 2);
            } else {
                // set status to queued
                updateSolverQueueStatus(this.solverId, modelId, "queued").then(() => {
                    console.log("Solver status updated");
                });
            }
        } else {
            this.dequeue();
            this._addPending(modelId);
        }
    }

    _addPending(modelId) {
        this.pendingQueue.push(modelId);
        updateSolverQueueStatus(this.solverId, modelId, "pending").then(() => {
            console.log("Solver status updated");
        });
    }

    dequeue() {
        if (this.runningQueue.length > 0) {
            // get the solver_id of the first solver in the queue
            const modelId = this.runningQueue[0];

            // remove the first solver from the queue
            this.runningQueue.shift();

            // run the solver with the solver_id
            terminateSolver(modelId).then(r => {
                console.log("Solver terminated");
            })

            stopCppScript(modelId);

            // run the next solver in the queue
            if (this.runningQueue.length > 0) {
                const nextModelId = this.runningQueue[0];
                runCppScript(this.solverId, nextModelId, 30, 2);
            }

        } else {
            console.log("Solver queue empty");
        }
    }

    // remove a specific element matching a given solver_id from the queue and terminate the solver
    remove(modelId) {
        if (this.runningQueue.length > 0) {
            // get the index of the solver_id in the queue
            const index = this.runningQueue.indexOf(modelId);

            // remove the solver from the queue
            this.runningQueue.splice(index, 1);

            // terminate the solver
            terminateSolver(modelId).then(r => {
                console.log("Solver terminated");
            })

            stopCppScript(modelId);

        } else {
            console.log("Solver queue empty");
        }
    }

    // when the python script is finished, remove the solver from the queue
    async removeOnFinish(modelId) {
        console.log("process completed, removing solver from queue");
        if (this.runningQueue.length > 0) {
            // get the index of the solver_id in the queue
            const index = this.runningQueue.indexOf(modelId);

            // delete the model / solver from the solver_queue table
            console.log(`Attempting to delete model ${modelId} with solver_id ${this.solverId}`);

            let {error} = await supabase
                .from('solver_queue')
                .delete()
                .eq('solver_id', this.solverId)
                .eq('model_id', modelId);

            if (error) {
                console.error('Error deleting solver_queue:', error);
            }

            // remove the solver from the queue
            this.runningQueue.splice(index, 1);

            // remove the model from the bin directory
            if (fs.existsSync(path.join(__dirname, 'bin', modelId + ".gz"))) {
                fs.unlinkSync(path.join(__dirname, 'bin', modelId + ".gz"));
            }
            if (fs.existsSync(path.join(__dirname, 'bin', modelId + ".txt"))) {
                fs.unlinkSync(path.join(__dirname, 'bin', modelId + ".txt"));
            }
            if (fs.existsSync(path.join(__dirname, 'bin', modelId + "_vars.json"))) {
                fs.unlinkSync(path.join(__dirname, 'bin', modelId + "_vars.json"));
            }
            if (fs.existsSync(path.join(__dirname, 'bin', modelId + "_vars_list.json"))) {
                fs.unlinkSync(path.join(__dirname, 'bin', modelId + "_vars_list.json"));
            }

            // set the status of the model to completed
            updateModelStatus(modelId, "completed");
        } else {
            console.log("Solver queue empty");
        }

        if (this.pendingQueue.length > 0) {
            console.log("running next model");
            const nextModelId = this.pendingQueue[0];
            this.pendingQueue.shift();
            this.enqueue(nextModelId);
        }
    }

    // get the current status of the solver
    isRunning(modelId) {
        if (this.runningQueue.length > 0) {
            return this.runningQueue.includes(modelId);
        } else {
            return false;
        }
    }
}

// terminate a solver with a given solver_id
const terminateSolver = async (solverId) => {
    let {error} = await supabase
        .from('solver_queue')
        .update({status: "terminated"})
        .eq('solver_id', solverId)

    if (error) {
        console.error('Error terminating solver:', error);
        return;
    }
}

// define a map of solverQueues based on solver_id
let solverQueues = new Map();

const getServerId = async () => {
    let {data: servers, error: fetchError} = await supabase
        .from('servers')
        .select('server_id')
        .eq('mac_address', localServerState.macAddress);

    if (fetchError) {
        console.error('Error fetching server_id:', fetchError);
        throw new Error('Error fetching server_id');
    }

    if (!servers.length) {
        console.error('No server found with the given MAC address:', localServerState.macAddress);
        await resetServerAndSolver();
        throw new Error('Server reset due to deletion. Re-initializing.');
    }

    return servers[0].server_id;
}


// set the SolverQueue objects based on the solvers in the DB
const setSolverQueueStructures = async () => {
    try {
        const serverId = await retry(getServerId, 2000);

        let {data: solvers, error} = await supabase
            .from('solvers')
            .select('solver_id')
            .eq('server_id', serverId);

        if (error) {
            console.error('Error fetching solvers:', error);
            return;
        }

        // for each solver in the solvers array, add it to the solverQueue, it should have a max length of num_instances
        for (const solver of solvers) {
            const solverId = solver.solver_id;
            const numInstances = await getNumInstances(solverId);
            solverQueues.set(solverId, new SolverQueue(solverId, numInstances));
        }

        return solvers.length;
    } catch (error) {
        console.error("ServerID not found ", error);
    }
}


// get the number of instances associated with a solver_id by querying the solvers table
const getNumInstances = async (solverId) => {
    let {data: solvers, error} = await supabase
        .from('solvers')
        .select('num_instances')
        .eq('solver_id', solverId);

    if (error) {
        console.error('Error fetching solvers:', error);
        return;
    }

    return solvers[0].num_instances;
}


// retrieve the auto generated server_id and insert a new row in the solvers table with the server_id
const addSolver = async () => {
    const serverId = await retry(getServerId, 2000);

    let {error} = await supabase
        .from('solvers')
        .insert([{server_id: serverId, owner_id: userID}])

    if (error) {
        console.error('Error inserting solver:', error);
    }
}

// get all solvers associated with the current server
const getSolvers = async () => {
    const serverId = await retry(getServerId, 2000);

    let {data: solvers, error} = await supabase
        .from('solvers')
        .select('*')
        .eq('server_id', serverId);

    if (error) {
        console.error('Error fetching solvers:', error);
        return;
    }

    console.log("found " + solvers.length + " preexisting solvers");

    return solvers;
}

// If there is no solver associated with the current server, if fail attempt to add one every 10 seconds
const addSolverIfAbsent = async () => {
    try {
        let solvers = await getSolvers();

        // check if solvers is defined
        if (!solvers) {
            console.log("solvers is undefined");
            return;
        }

        if (!solvers.length) {
            try {
                await addSolver();
                console.log("No solver found, added solver");
            } catch (error) {
                debugLog("Error adding solver, retrying in 10 seconds", error);
                setTimeout(addSolverIfAbsent, 10000);
            }
        }
    } catch (error) {
        console.error("An error occurred:", error);
    }
}


// get the models with status "ready" from the solver_queue table
const getReadyModels = async () => {
    const serverId = await retry(getServerId, 2000);

    let {data: models, error} = await supabase
        .from('solver_queue')
        .select('model_id, solver_id')
        .eq('status', 'ready')
        .eq('server_id', serverId);

    if (error) {
        console.error('Error fetching models:', error);
        return;
    }

    return models;
}


// check for ready models in the solver_queue table every 1 second
const startCheckForReadyModels = async () => {
    setInterval(async () => {
        // Fetch models with status "ready"
        const readyModels = await getReadyModels();

        // console.log(`Found ${readyModels.length} ready models:` + readyModels.map(m => m.model_id).join(', ') + ".");

        // Check if there are any ready models, if not, return
        if (!readyModels) {
            return;
        }

        // For each ready model, add it to the solver queue
        for (const model of readyModels) {
            const {model_id, solver_id} = model;

            console.log("Solver id: " + solver_id + " Model id: " + model_id);

            solverQueues.get(solver_id).enqueue(model_id);
            console.log(`Solver ${solver_id} enqueued model ${model_id}`);
        }
    }, 1000); // Check every 1 second
};

// update the status column of a specific row in the models table with the specified model_id with the given status
const updateModelStatus = async (modelId, status) => {
    let {error} = await supabase
        .from('models')
        .update({status: status})
        .eq('model_id', modelId);

    if (error) {
        console.error('Error updating model status:', error);
    }
}

// update the status column of a specific row in the solver_queue table with the specified solver_id and model_id with the output of the python script
const updateSolverQueueStatus = async (solver_id, model_id, output) => {

    // update the status of the row in solver_queue with the given solver_id and model_id with the output value given
    let {error} = await supabase
        .from('solver_queue')
        .update({status: output})
        .eq('solver_id', solver_id)
        .eq('model_id', model_id)

    if (error) {
        console.error('Error updating solver_queue:', error);
    }
    // update the updated_at column of a specific row in the solver_queue table with the current server time
    // (already done in the trigger function)
}

function deepFlatten(obj) {
    let flatArray = [];
    for (const key in obj) {
        const value = obj[key];
        if (Array.isArray(value)) {
            flatArray = flatArray.concat(value);
        } else if (typeof value === 'object') {
            flatArray = flatArray.concat(deepFlatten(value));
        } else {
            flatArray.push(value);
        }
    }
    // remove all strings from the array
    return flatArray.filter(val => typeof val !== 'string');
}

function deepMap(obj, array) {
    let counter = 0;

    function helper(input) {
        if (Array.isArray(input)) {
            let arrayVals = input.map(val => typeof val === 'string' ? parseInt(val) : array[counter++])
                .filter(val => val !== undefined);
            if (arrayVals.length === 3 && arrayVals.every(val => typeof val === 'number')) {
                if (arrayVals[2] === 0) {
                    return undefined;
                }
                if (arrayVals[2] === 1) {
                    arrayVals.pop();
                } else {
                    throw new Error(`Invalid is_present value: ${arrayVals[2]}`);
                }
            }
            return arrayVals.length > 0 ? arrayVals : undefined;
        } else if (typeof input === 'object' && input !== null) {
            const newObj = {};
            for (const key in input) {
                const value = helper(input[key]);
                if (value !== undefined) {
                    newObj[key] = value;
                }
            }
            return Object.keys(newObj).length > 0 ? newObj : undefined;
        } else if (typeof input === 'string') {
            return isNaN(parseInt(input)) ? input : parseInt(input);
        } else {
            return array[counter++];
        }
    }

    const result = helper(obj);
    const filteredResult = {};
    for (const key in result) {
        if (result[key] !== undefined) {
            filteredResult[key] = result[key];
        }
    }
    return filteredResult;
}


let cppProcesses = new Map();

const runCppScript = async (solver_id, model_id, duration, interval) => {
    // Spawn the C++ process
    // let test_model_id = "22931d4b-052f-43d2-8466-617af8de0803";
    let test_model_id = "2e7ab3e6-7c06-4c34-9227-a476db3fbda7";
    test_model_id = model_id;

    const fs = require('fs');
    const path = require('path');
    let structuredIndexJson = null;

    const blobToBuffer = (blob) => {
        return new Promise((resolve, reject) => {
            const reader = blob.stream().getReader();
            const chunks = [];

            const pump = () => {
                reader.read().then(({value, done}) => {
                    if (done) {
                        resolve(Buffer.concat(chunks));
                        return;
                    }
                    chunks.push(Buffer.from(value));
                    pump();
                }).catch(reject);
            };

            pump();
        });
    };


    const downloadModel = async () => {
        let model_extension = ".gz";
        let data;

        debugLog("Downloading model with gz extension");
        let {data: gz_data, error: gz_error} = await supabase.storage
            .from('models')
            .download(test_model_id + model_extension);

        if (gz_error) {
            debugLog(`Error downloading model with gz extension: ${gz_error}`);
            debugLog("Attempting to download model with txt extension");
            let {data: txt_data, error: txt_error} = await supabase.storage
                .from('models')
                .download(test_model_id + ".txt");

            if (txt_error) {
                console.error(`Error downloading model with txt extension: ${txt_error}`);
                return;
            }
            debugLog("TXT data download successful, setting data to txt_data");
            data = txt_data;
            debugLog(!data ? "Data is undefined" : "Success! Data is defined");
        } else {
            debugLog("GZ data download successful, setting data to gz_data");
            data = gz_data;
            debugLog(!data ? "Data is undefined" : "Success! Data is defined");
        }

        if (!data) {
            console.error("Data is undefined, exiting");
            return;
        }

        const resolvedData = await blobToBuffer(data);
        try {
            fs.writeFileSync(path.join(__dirname, 'bin', test_model_id + model_extension), resolvedData);
        } catch (err) {
            console.error(err);
        }

        return model_extension;
    };

    const downloadModelVars = async () => {

        const {data, error} = await supabase.storage
            .from('models')
            .download(`${test_model_id}_vars.json`);

        if (error) {
            console.error(error);
            return;
        }

        // Convert Blob to Buffer
        const resolvedData = await blobToBuffer(data);

        // Parse the buffer to JSON
        const jsonData = JSON.parse(resolvedData.toString());
        structuredIndexJson = jsonData;

        console.log("structuredIndexJson", structuredIndexJson);

        fs.writeFileSync(path.join(__dirname, 'bin', `${test_model_id}_vars.json`), resolvedData);

        const taskList = deepFlatten(jsonData);

        // Convert the JSON object back to string
        const editedData = taskList.join(',');

        // Write the edited JSON back to ./bin folder
        fs.writeFileSync(path.join(__dirname, 'bin', `${test_model_id}_vars_list.json`), editedData);


    };


// Call the download functions

    let model_extension = await downloadModel();
    await downloadModelVars();

    console.log("Model vars downloaded");

    const cppProcess = spawn('./bin/mod_sat_runner', [
        '--input=./bin/' + test_model_id + model_extension,
        '--callback=./bin/' + test_model_id + '_vars_list.json',
        '--print_wait=200',
        '--objective_print_wait=3000',
        '--params=log_search_progress:false,num_search_workers:8'
    ]);

    const id = solver_id + " " + model_id;

    const removeFiles = () => {
        if (fs.existsSync(path.join(__dirname, 'bin', test_model_id + model_extension))) {
            fs.unlinkSync(path.join(__dirname, 'bin', test_model_id + model_extension));
        } else {
            console.log(`File ${test_model_id}.txt does not exist`);
        }
        if (fs.existsSync(path.join(__dirname, 'bin', `${test_model_id}_vars.json`))) {
            fs.unlinkSync(path.join(__dirname, 'bin', `${test_model_id}_vars.json`));
        } else {
            console.log(`File ${test_model_id}_vars.json does not exist`);
        }
    }

    // Listen for data events to capture the output
    cppProcess.stdout.on('data', async (data) => {
        const outputData = data.toString().trim().split(",");

        const time_from_start = outputData[0];
        const status = outputData[1]; // 2 == feasible, 4 == optimal
        const score = outputData[2];

        // get the user_id with the associated model_id
        let {data: user, user_error} = await supabase
            .from('models')
            .select('user_id')
            .eq('model_id', model_id);

        if (user_error) {
            console.log("Error getting user_id when inserting solution_score: ", user_error);
        }

        // insert into the solution_scores table a new row with values for solution_score_id (random uuid), user_id, model_id, time_from_start, score, and is_optimal:
        const is_optimal = status === "4";
        const solution_score_id = crypto.randomUUID();

        let {error} = await supabase
            .from('solution_scores')
            .insert([{
                solution_score_id: solution_score_id,
                user_id: user[0]?.user_id,
                model_id: model_id,
                time_from_start: time_from_start,
                score: score,
                is_optimal: is_optimal
            }])

        if (error) {
            console.error('Error inserting solution_score:', error);
        }

        if (outputData.length > 3) {
            console.log(`Output for process ${id} has length ${outputData.length} and is:`, outputData);

            const newVals = outputData.slice(3).map(val => parseInt(val));
            const structuredValJson = deepMap(structuredIndexJson, newVals);
            console.log("new vals", structuredValJson);

            let {error} = await supabase
                .rpc('upsert_solution', {
                    p_user_id: user[0]?.user_id,
                    p_model_id: model_id,
                    p_solution_json: structuredValJson,
                    p_solution_score_id: solution_score_id
                });

            if (error) {
                console.error('Error upserting solution:', error);
            }
        }


    });

    // Listen for error output
    cppProcess.stderr.on('data', (data) => {
        const error = data.toString().trim();
        console.error(`Error for process ${id}:`, error);
        updateSolverQueueStatus(solver_id, model_id, 'failed');
        updateModelStatus(model_id, 'failed');
        // remove the downloaded files, but check if they exist first
        removeFiles();
    });


    // Handle process exit
    cppProcess.on('exit', (code) => {
        console.log(`C++ process ${id} exited with code ${code}`);
        // Remove the process from the Map
        cppProcesses.delete(id);
        // Remove the solver from its respective queue
        solverQueues.get(solver_id).removeOnFinish(model_id);
        // remove the downloaded files if they exist
        removeFiles();
    });

    // Store process in he Map with id as the key
    cppProcesses.set(id, cppProcess);
}

const stopCppScript = (id) => {
    const cppProcess = cppProcesses.get(id);
    if (cppProcess) {
        cppProcess.kill();
        cppProcesses.delete(id);
        console.log(`C++ process ${id} was terminated`);
    } else {
        console.log(`C++ process ${id} not found`);
    }
}

async function initializeServerAndSolver() {
    const [mac, ip] = await Promise.all([
        retry(getMACAddress, 10000),
        retry(getIPAddress, 10000),
    ]);

    localServerState.macAddress = mac;
    localServerState.ipAddress = ip;
    localServerState.cpuCores = os.cpus().length;

    await addServerIfAbsent(localServerState);
    console.log("Server added");

    await addSolverIfAbsent();
    console.log("Solver checked");

    await setSolverQueueStructures();
    console.log("Solver queues set");
}

async function resetServerAndSolver() {
    try {
        await initializeServerAndSolver();
    } catch (error) {
        console.error('An error occurred during reset:', error);
    }
}

async function main() {
    try {
        await initializeServerAndSolver();
    } catch (error) {
        console.error('An error occurred during initialization of Server and Solver:', error);
    }
    try {
        await startCheckForReadyModels();
    } catch (error) {
        console.error('An error occurred while checking and processing ready models :', error);
    }
    console.log("Started checking for ready models.");
}

main();

module.exports = {deepFlatten, deepMap};