async function launchBrowser() {
    return webkit.launch({
        headless: true
    });
}
