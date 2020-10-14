/*
 * Copyright (c) 2019 - 2020 Geode-solutions
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

 // require modules
var fs = require("fs");
var path = require("path");
var archiver = require("archiver");
var version = require("./version.json");
const fetch = require('node-fetch');
const {Octokit} = require('@octokit/rest');
const mkdirp = require('mkdirp')
const extract = require('extract-zip')
const { exec } = require("child_process");
const rimraf = require("rimraf").sync;


// exec(
//   "python -m pip install -r server/requirements.txt -t server/pip",
//   (err, stdout, stderr) => {
//     console.log(`stdout: ${stdout}`);
//     console.log(`stderr: ${stderr}`);
//   }
// );




const dir = "GeodePackage" + "-" + process.argv[2] + "-" + process.argv[3];
mkdirp.sync(dir);
const owner = "Geode-solutions"

var octokit = new Octokit({auth: "cdaf2908ce0d076eca1a10f6d736e023d57e379a"});

function getRelease(repo, version, isModule) {
  const outputDirectory = isModule ? path.join(dir, "modules") : dir;
  return new Promise((resolve, reject) => {
  console.log(repo, version);
  const tag = "v" + version;
  octokit.repos.getReleaseByTag({owner, repo, tag}).then(release => {
    const release_id = release.data.id;
    // console.log(release);
    octokit.repos.listReleaseAssets({owner, repo, release_id})
        .then(assets => {
          const asset = assets.data.find(asset => asset.name.includes(process.argv[3]));
          console.log('Asset name:', asset.name);
          let assetUrl = asset.url;
          assetUrl = assetUrl.concat('?access_token=cdaf2908ce0d076eca1a10f6d736e023d57e379a');
          fetch(assetUrl, {
            headers: {accept: 'application/octet-stream'}
          }).then(response => {
            const outputFile = repo.concat(".zip");
            console.log('Downloading to:', outputFile);
            response.body.pipe(fs.createWriteStream(outputFile))
                .on('finish', function() {
                    console.log('Unzipping', outputFile);
                    try {
                      extract(outputFile, { dir: path.resolve(outputDirectory) }).then(()=>{
                        let extractedDirectory = "";
                        if( isModule ) {
                          const extractedName = asset.name.slice(0, -4);
                          extractedDirectory = path.join(outputDirectory, repo);
                          rimraf(extractedDirectory);
                          fs.renameSync(path.join(outputDirectory, extractedName),extractedDirectory);
                        }
                        else{
                          extractedDirectory = dir;
                        }
                        console.log('Unzip to:', repo);
                        const pipDestination = path.join(dir,"server");
                        if (!fs.existsSync(pipDestination)){
                        fs.mkdirSync(pipDestination);
                        }
                        exec(
                          "python -m pip install --upgrade -r " + path.join(extractedDirectory,"server/requirements.txt") + " -t " + pipDestination,
                        (err, stdout, stderr) => {
                          console.log(`stdout: ${stdout}`);
                          console.log(`stderr: ${stderr}`);
                        });
                        resolve();
                      });
                    } catch (error) {
                      reject(error);
                    }
                });
          });
        });
      }).catch((error)=>{
        console.log(error);
        reject(error);
      });
  });
}

let promises = [];
let config = { modules:[]};
promises.push(getRelease("Geode", version.geode, false));
for (let [repo, tag] of Object.entries(version.modules)) {
  const repoGeode = repo.concat(".geode");
  config.modules.push(path.join("modules", repoGeode, "config.json"));
  promises.push(getRelease(repoGeode, tag, true));
}
fs.writeFileSync(path.join(dir,'config.json'), JSON.stringify(config));

Promise.all(promises).then(()=>{
// create a file to stream archive data to.
const outputName = path.join(__dirname, dir + ".zip");
console.log("Output: ", outputName);
var output = fs.createWriteStream(outputName);
var archive = archiver("zip");

// listen for all archive data to be written
// 'close' event is fired only when a file descriptor is involved
output.on("close", function() {
  console.log(archive.pointer() + " total bytes");
  console.log(
    "archiver has been finalized and the output file descriptor has closed."
  );
});

// This event is fired when the data source is drained no matter what was the data source.
// It is not part of this library but rather from the NodeJS Stream API.
// @see: https://nodejs.org/api/stream.html#stream_event_end
output.on("end", function() {
  console.log("Data has been drained");
});

// good practice to catch warnings (ie stat failures and other non-blocking errors)
archive.on("warning", function(err) {
  if (err.code === "ENOENT") {
    // log warning
  } else {
    // throw error
    throw err;
  }
});

// good practice to catch this error explicitly
archive.on("error", function(err) {
  throw err;
});

// pipe archive data to the file
archive.pipe(output);

archive.directory(dir);

// finalize the archive (ie we are done appending files but streams have to finish yet)
// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
archive.finalize();
});
