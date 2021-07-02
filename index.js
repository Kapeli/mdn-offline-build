const fs = require('fs-extra');
const path = require('path');
const fastGlob = require('fast-glob');
const sqlite3 = require('sqlite3');
const execSync = require('child_process').execSync;

const { buildIndex } = require('./build/build-index');
const postProcess = require('./build/post-process');

const webextensionsSubtree = 'en-us';
const docsWebextensionsSubtree = 'en-us/docs';
const mdnContentFolder = path.resolve(__dirname, 'mdn/content/files');
const webextensionsContentFolder = path.resolve(mdnContentFolder, webextensionsSubtree);

const mdnYariFolder = path.resolve(__dirname, 'mdn/yari');
const builtPagesFolder = path.resolve(mdnYariFolder, 'client/build');

const outputFolder = path.resolve(__dirname, 'webextensions.docset/Contents/Resources');
const documentsFolder = path.resolve(outputFolder, 'Documents');
const searchIndexFile = path.resolve(outputFolder, 'docSet.dsidx');
const searchOptimizedIndexFile = path.resolve(outputFolder, 'optimizedIndex.dsidx');

function rm(file) {
    try {
        fs.rmSync(file, { recursive: true });
    } catch (o_0)
             { }
}

function generateSQL(apiDocs) {
    const rows = buildIndex(apiDocs);
    let sql = `
        CREATE TABLE searchIndex(id INTEGER PRIMARY KEY, name TEXT, type TEXT, path TEXT);
        CREATE UNIQUE INDEX anchor ON searchIndex (name, type, path);
    ` + rows.map(row => {
        if (row === null) {
            return '';
        }
        const [type, name, dir, desc] = row;

        // check if file is accessible
        const filePath = path.resolve(__dirname, 'webextensions.docset/Contents/Resources/Documents/' + dir);
        try {
            fs.accessSync(filePath);
        } catch (e) {
            console.error(`Error: File "${filePath}" is inaccessible`);
            return '';
        }
        return `INSERT OR IGNORE INTO searchIndex(name, type, path) VALUES ('${name}', '${type}', '${dir}#<dash_entry_titleDescription=${encodeURIComponent(desc)}>');\n`;
    }).join('');
    return sql;
}

async function main() {
    const tempContentFolder = path.resolve(__dirname, 'mdn_content');
    const tempWebextensionsFolder = path.resolve(tempContentFolder, webextensionsSubtree);

    // Clean up the previous build (database, Documents folder)
    console.log('Cleaning up...');
    rm(builtPagesFolder);
    rm(documentsFolder);
    rm(tempContentFolder);
    fs.mkdirSync(documentsFolder, { recursive: true});
    rm(searchIndexFile);
    rm(searchOptimizedIndexFile);

    // Copy webextension APIs to the temp dir
    fs.mkdirSync(tempWebextensionsFolder, { recursive: true });
    fs.copySync(path.resolve(mdnContentFolder, 'popularities.json'), path.resolve(tempContentFolder, 'popularities.json'));
    fs.copySync(webextensionsContentFolder, tempWebextensionsFolder);

    // Build MDN pages from extracted content
    console.log('Building MDN docs...');
    execSync(`echo CONTENT_ROOT="${tempContentFolder}" > .env`, {
        cwd: mdnYariFolder,
        stdio: ['pipe', 'ignore', 'pipe'],
    });

    execSync(`yarn prepare-build`, {
        cwd: mdnYariFolder,
        stdio: ['pipe', 'ignore', 'pipe'],
    });

    execSync(`yarn build`, {
        cwd: mdnYariFolder,
        stdio: ['pipe', 'ignore', 'pipe'],
    });

    // Copy built MDN pages to Documents folder
    fs.copySync(builtPagesFolder + '/assets', documentsFolder + '/assets');
    fs.copySync(builtPagesFolder + '/static', documentsFolder + '/static');
    fs.copySync(builtPagesFolder + '/en-us/docs', documentsFolder + '/en-us/docs');

    // Fix built MDN pages (remove scripts, fix static URLs, build TOC and so forth)
    console.log('Post processing...')
    const filePaths = fastGlob.sync(path.resolve(documentsFolder, docsWebextensionsSubtree, '**/index.html'));
    postProcess(filePaths, documentsFolder);

    // // Create database
    // console.log('Building index...')
    // const apiDocs = fastGlob.sync(
    //     path.resolve(tempWebextensionsFolder, '**/*.html')
    // );

    // await new Promise((resolve, reject) => {
    //     sqlite3.verbose();
    //     const db = new sqlite3.Database(searchIndexFile);
    //     db.on('error', (err) => {
    //         console.error('Error:', err);
    //         reject(err);
    //     });
    //     // Populate index
    //     db.on('open', () => {
    //         db.exec(generateSQL(apiDocs), () => {
    //             db.close();
    //             resolve();

    //         });
    //     });
    // });

    // // Archive
    // console.log('Packing...')
    // execSync(`tar --exclude='.DS_Store' -cvzf WebExtensions.tgz webextensions.docset`, { stdio: ['pipe', 'ignore', 'pipe'] });

    console.log('Done!');
}

main();
