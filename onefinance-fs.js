import Fs from "node:fs/promises";
import Path from "node:path";
import Os from "node:os";

import One from "onefinance";

let OneFs = {};

let url = new globalThis.URL(import.meta.url);
let __dirname = Path.dirname(url.pathname);
let HOME = "";

OneFs.init = async function () {
    HOME = Os.homedir();
    let jwt = await Fs.readFile(
        `${HOME}/.config/onefinance/bearer.jwt`,
        "utf8"
    );
    jwt = jwt.trim();

    let ttl = await One.init(jwt);
    return ttl;
};

OneFs.pockets = async function () {
    // TODO read timestamp
    let pocketsJSON = await Fs.readFile(
        `${HOME}/.config/onefinance/pockets.json`
    ).catch(function (err) {
        return null;
    });

    if (pocketsJSON) {
        let pockets = JSON.parse(pocketsJSON);
        return pockets;
    }

    let pockets = await One.pockets();
    pocketsJSON = JSON.stringify(pockets);

    await Fs.mkdir(`${HOME}/.config/onefinance`, {
        mode: 0o700,
        recursive: true,
    });
    await Fs.writeFile(`${HOME}/.config/onefinance/pockets.json`, pocketsJSON, {
        mode: 0o600,
        encoding: "utf8",
    });

    return pockets;
};

OneFs.transactions = async function (pocketId) {
    // ex: pocket.00000000-0000-4000-8000-000000000000
    let isInvalid = !/pocket\.[\w-]{36}/.test(pocketId);
    if (isInvalid) {
        throw new Error(`invalid pocketId ${pocketId}`);
    }

    let cacheFile = `${HOME}/.config/onefinance/transactions-${pocketId}.json`;
    let transactionsJSON = await Fs.readFile(cacheFile).catch(function (err) {
        return null;
    });

    let transactions = [];
    if (transactionsJSON) {
        console.warn(`DEBUG using cache: ${cacheFile}`);
        transactions = JSON.parse(transactionsJSON);
    }

    let latestTrnId = transactions[0]?.trn_id || "";
    let newerTransactions = await One.transactions(pocketId, latestTrnId);
    if (newerTransactions.length) {
        if (transactions.length) {
            console.warn(`DEBUG new transactions:`, newerTransactions.length);
        }
        transactions = newerTransactions.concat(transactions);
    }

    transactionsJSON = JSON.stringify(transactions);
    await Fs.mkdir(`${HOME}/.config/onefinance`, {
        mode: 0o700,
        recursive: true,
    });
    await Fs.writeFile(
        `${HOME}/.config/onefinance/transactions-${pocketId}.json`,
        transactionsJSON,
        {
            mode: 0o600,
            encoding: "utf8",
        }
    );

    return transactions;
};

export default OneFs;
