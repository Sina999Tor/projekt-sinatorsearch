exports.handler = async function(event) {
    const file = (event.queryStringParameters || {}).file || 'czech';

    const urls = {
        czech:    'https://www.open-epg.com/files/czech3.xml',
        slovakia: 'https://www.open-epg.com/app/download.php?file=slovakia1.xml'
    };

    const url = urls[file];
    if (!url) {
        return { statusCode: 400, body: 'Unknown file' };
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EPG-Fetcher/1.0)',
                'Accept': 'application/xml, text/xml, */*'
            },
            signal: AbortSignal.timeout(25000)
        });

        if (!response.ok) {
            return { statusCode: 502, body: `Upstream error: ${response.status}` };
        }

        const xml = await response.text();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600'  // cache 1 hodinu
            },
            body: xml
        };
    } catch (err) {
        return { statusCode: 500, body: `Fetch failed: ${err.message}` };
    }
};
