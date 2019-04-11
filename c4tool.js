const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const program = require('commander');
const yaml = require('js-yaml');
const watch = require('recursive-watch');
const sort = require('./ordering.js');

/**
 * Return the absolute path of the Chrome/Chromium executable of the system
 */
const chromePath = () => {
    const possiblePaths = {
        'win32': [
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Application\\chrome.exe',
        ],
        'darwin': [
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ],
        'linux': [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
        ]
    };

    return possiblePaths[process.platform].find(path => fs.existsSync(path)) || null;
};

/**
 * Sort a given c4 diagram using the ordering provided by the initial one
 * 
 * @param {string} initial The initial diagram
 * @param {string} actual  The actual diagram
 * 
 * @return {string} The properly ordered diagram
 */
const sortDiagram = (initialDiagram, actualDiagram) => {
    const initial = yaml.load(initialDiagram);
    const actual  = yaml.load(actualDiagram);

    sort( // sort elements
        actual, '$', 'elements', 
        initial, () => '$..elements[*]', 
        ['name']
    );

    sort( // sort relationships
        actual, '$', 'relationships', 
        initial, () => '$..relationships[*]', 
        ['source', 'destination']
    );

    sort( // sort element's containers
        actual, '$..elements[?(@.containers)]', 'containers', 
        initial, (element) => `$..elements[?(@.containers && @.name=="${element.name}")].containers[*]`, 
        ['name']
    );

    return yaml.dump(actual);
};

/**
 * Space out objects in a map
 * 
 * @param {string} diagram 
 */
const formatDiagram = (diagram) => {
    const regex = /([^:])\n(\s{1,})-/g;

    return diagram.replace(regex, '$1\n\n$2-');
}

/**
 * Puppeteer options used to lunch a new Chrome instance
 * 
 * @param {boolean} headless 
 */
const puppeteerOptions = (headless) => {
    return {
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        executablePath: chromePath(),
        headless: headless,
        args: ['--disable-infobars', '--no-sandbox']
    };
}

/**
 * Lunch a new browser
 * 
 * @param {boolean} headless 
 */
const launchBrowser = async (headless) => {
    try {
      const options = puppeteerOptions(headless);
      return await puppeteer.launch(options);
    } catch (err) {
      console.error(`could not launch browser: ${err}\n${err.stack}`);
      process.exit(2);
    }
}

const fileContent = (filename) => {
    const resolved = path.resolve(filename);
    if (!fs.existsSync(resolved)) {
        console.error(`${filename} was not found`);
        process.exit(2);
    }

    return fs.readFileSync(resolved, 'utf8');
}

/**
 * Ensure that a given yaml string starts with a document separator.
 * Otherwize, it won't load on Structurizr Express.
 * 
 * @param {string} yamlString 
 * 
 * @return {string}
 * 
 */
const prepareYaml = (yamlString) => {
    const sepLoc = yamlString.indexOf('---');

    return sepLoc >= 0 ? yamlString.substring(sepLoc) : `---\n${yamlString}`;
}

const removeEmptyElements = (obj) => {
    var isArray = obj instanceof Array;
    for (var k in obj) {
      if (obj[k] === null || obj[k] === '') isArray ? obj.splice(k, 1) : delete obj[k];
      else if (typeof obj[k] == "object") removeEmptyElements(obj[k]);
      if (isArray && obj.length == k) removeEmptyElements(obj);
    }

    return obj;
};

/**
 * Remove empty properties from in a YAML string
 * 
 * @param {string} yamlString 
 * 
 * @return {string} A YAML string without empty properties
 */
const cleanupYaml = (yamlString) => {
    const cleanedObject = removeEmptyElements(yaml.load(yamlString));

    return yaml.dump(cleanedObject);
};

/**
 * Load Structurizr Express in a page
 * 
 * @param {puppeteer.browser} browser
 * 
 * @return {puppeteer.page}
 */
const structurizrExpressPage = async (browser) => {
    const url = 'https://structurizr.com/express';
    const page = await browser.newPage();
    const disableExpressIntroduction = {
        name: 'structurizr.hideExpressIntroduction', 
        value: 'true', 
        domain: 'structurizr.com'
    };

    await page.setCookie(disableExpressIntroduction);
    await page.goto(url);
    await page.waitForXPath("//*[name()='svg']");

    return page;
};

/**
 * Load a YAML string into Structurizr Express
 * 
 * @param {puppeteer.page} page 
 * @param {string} yamlDiagram 
 */
const renderDiagramInExpress = async (page, yamlDiagram) => {
    return page.evaluate(
        (yamlDiagram) => structurizr.scripting.renderExpressDefinition(yamlDiagram), 
        yamlDiagram
    );
};

/**
 * Update Structurizr Express
 * 
 * @param {puppeteer.page} page 
 */
const updateStructurizrExpress = async (page) => {
    return page.evaluate(() => {
        window.diagramToStructurizrExpress();
        window.updateExpressControls(true);
    });
};

const zoomFitContent = async (page) => {
    await page.evaluate(() => {
        Structurizr.diagram.zoomFitContent();
    });
}

/**
 * CLI action used to edit a givan diagram in Structurizr Express
 * 
 * @param {string} filename A diagram file name
 */
const editDiagram = async (filename) => {
    var   initialDiagram = prepareYaml(fileContent(filename));
    const browser = await launchBrowser(false);
    const page = await structurizrExpressPage(browser);

    await renderDiagramInExpress(page, initialDiagram);
    await updateStructurizrExpress(page);

    // Save edited diagram to the local file
    await page.exposeFunction('sendDiagram', async (updatedDiagram) => {
        const schemaPath = path.resolve(filename);
        var updatedDiagram = cleanupYaml(updatedDiagram);
            updatedDiagram = sortDiagram(initialDiagram, updatedDiagram);
            updatedDiagram = formatDiagram(updatedDiagram);

        fs.writeFileSync(schemaPath, updatedDiagram);
        console.log(`saved diagram ${schemaPath} from Scructurizr Express`);

        await exportDiagramToPNG(page, schemaPath);
    })

    // Create a save diagram button
    await page.evaluate(async () => {
        let saveToFileButton = document.createElement('button');
        saveToFileButton.setAttribute('class', 'btn btn-default btn-primary');
        saveToFileButton.setAttribute('id', 'saveToFile');
        saveToFileButton.innerHTML = '<img src="/static/glyphicons/glyphicons-basic-199-save.svg" class="glyphicon-btn glyphicon-white"> Save to file';
    
        const saveButton = document.querySelector('button#saveStructurizrExpressButton');
        saveButton.parentElement.appendChild(saveToFileButton);
        saveButton.parentElement.removeChild(saveButton);

        saveToFileButton.addEventListener('click', async () => {
            window.diagramToStructurizrExpress();
            window.sendDiagram(window.toYamlString());
        });
    });

    watch(filename, async (filename) => {
        const date = (new Date).toString();
        const yamlDiagram = prepareYaml(fileContent(filename));
        await renderDiagramInExpress(page, yamlDiagram);
        await updateStructurizrExpress(page);
        await zoomFitContent(page);
        initialDiagram = yamlDiagram;
        console.log(`${date} re-rendering diagram in Structurizr Express`);
    });

    console.log('To exit, press Ctrl+C or close your browser');
};

/**
 * Export the a given diagram in PNG
 * 
 * @param {puppeteer.page} page 
 * @param {string} filename 
 */
const exportDiagramToPNG = async (page, filename) => {
    const pathInfo = path.parse(filename);
    const renderedPath = path.join(pathInfo.dir, pathInfo.name + '.png');
    const base64DataForDiagram = await page.evaluate(() => structurizr.scripting.exportCurrentDiagramToPNG());
  
    fs.writeFile(renderedPath, base64DataForDiagram.replace(/^data:image\/png;base64,/, ""), 'base64', (err) => {
        if (err) throw err;
        console.log(`${filename} rendered.`);
    });
}

/**
 * CLI action used to render a diagram
 * 
 * @param {string} filename A YAML diagram file name
 */
const renderDiagram = async (filename) => {
    const browser = await launchBrowser(true);
    const page = await structurizrExpressPage(browser);
    const yamlDiagram = prepareYaml(fileContent(filename));

    await renderDiagramInExpress(page, yamlDiagram);
    await exportDiagramToPNG(page, path.resolve(filename));

    browser.close();
};

/**
 * Check is a given filename correspond to a YAML file
 * 
 * @param {string} filename 
 */
const isAYamlFile = (filename) => {
    return /ya?ml$/.test(event.file);
};

/**
 * Check is a given filename is a directory
 * 
 * @param {string} directory 
 */
const withDirectory = (directory) => {
    const resolved = path.resolve(directory)
    try {
        const stat = fs.statSync(resolved);
    } catch (err) {
        console.error(`could not find directory: ${err}\n${err.stack}`);
        process.exit(2);
    }

    return resolved;
}

/**
 * CLI action used to watch a given directory which contains diagrams
 * 
 * @param {string} directory 
 */
const watchDiagrams = async (directory) => {
    const browser = await launchBrowser(true);
    const page = await structurizrExpressPage(browser);
    const target = withDirectory(directory);
    
    console.log(`watching directory ${target}`);

    watch(target, async (filename) => {
        if (/ya?ml$/.test(filename)) {
            const yamlDiagram = prepareYaml(fileContent(filename));
            await renderDiagramInExpress(page, yamlDiagram);
            await exportDiagramToPNG(page, filename);
        }
    });
};

/**
 * CLI configurations
 */
const run = () => {
    program
        .command('edit <filename>')
        .description('edit a diagram inside structurizr express!')
        .action(editDiagram);

    program
        .command('render <filename>')
        .description('render a given diagram into PNG')
        .action(renderDiagram);

    program
        .command('watch <directory>')
        .description('watch diagrams within a directory and generate PNG when modified')
        .action(watchDiagrams);

    program.parse(process.argv);

    if (!process.argv.slice(2).length) {
        program.outputHelp();
    }
};

run();
