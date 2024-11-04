#!/usr/bin/env node

import Fs from "node:fs/promises";
import Path from "node:path";

import UUID from "onefinance/uuid.js";

let fetch = globalThis.fetch;

let API = {};

API._jwt = function () {
    return "";
};

API._userId = function () {
    return "";
};

API.init = async function (jwt) {
    API._jwt = function () {
        return jwt;
    };

    let claims = API._parseJwt(jwt);
    let now = Date.now();
    let ttl = API._getJwtTtl(claims.exp, now);
    if (ttl <= 5) {
        let duration = API._formatDuration(ttl);
        throw new Error(`jwt expired ${duration} ago`);
    }

    let userId = claims["https://safecorp.com/safe_user_id"];
    API._userId = function () {
        return userId;
    };

    return ttl;
};

API._formatDuration = function (totalSeconds) {
    totalSeconds = Math.abs(totalSeconds);

    let hours = totalSeconds / 3600;
    hours = Math.floor(hours);
    let hoursStr = hours.toFixed(0);

    let minutes = totalSeconds % 3600;
    minutes = minutes / 60;
    minutes = Math.floor(minutes);
    let minutesStr = minutes.toString();
    minutesStr = minutesStr.padStart(2, "0");

    let seconds = totalSeconds % 60;
    let secondsStr = seconds.toString();
    secondsStr = secondsStr.padStart(2, "0");

    return `${hoursStr}h ${minutesStr}m ${secondsStr}s`;
};

API._parseJwt = function (token) {
    let parts = token.split(".");
    let payload = parts[1];

    let rfcBase64 = "";
    {
        let padLen = payload.length % 4;
        padLen = 4 - padLen;
        padLen = padLen % 4;

        let padding = "=".repeat(padLen);

        rfcBase64 = payload.replace(/-/g, "+");
        rfcBase64 = payload.replace(/_/g, "/");
        rfcBase64 += padding;
    }

    let json = globalThis.atob(rfcBase64);
    let data = JSON.parse(json);

    return data;
};

API._getJwtTtl = function (exp, now) {
    if (!now) {
        now = Date.now();
    }

    let epochF = now / 1000;
    let epoch = Math.ceil(epochF);

    let ttl = exp - epoch;

    return ttl;
};

API._request = async function (url, data) {
    let uuid = UUID.v4();

    let jwt = API._jwt();
    let headers = {
        Authorization: `Bearer ${jwt}`,
        "X-Safe-Request-ID": uuid,
        "Content-Type": "application/json",
    };

    let req = {
        method: "GET",
        headers: headers,
    };
    if (data) {
        let body = JSON.stringify(data);
        Object.assign(req, {
            method: "POST",
            body: body,
        });
    }
    let resp = await fetch(url, req);

    return resp;
};

API.pockets = async function () {
    let userId = API._userId();
    let url = `https://api.one.app/banking/v2/pockets?user_id=${userId}`;

    let resp = await API._request(url);
    if (!resp.ok) {
        let msg = await resp.text();
        throw new Error(`list pockets failed: ${resp.status} ${msg}`);
    }

    let pockets = await resp.json();
    return pockets;
};

API.transactions = async function (pocketId, latestTrnId = "") {
    let userId = API._userId();
    let limit = 250; // default: 50, max: ???
    let query = {
        pocketId: pocketId,
        userId: userId,
        limit: limit,
        include_pending_rdcs: true,
        force_refresh: false,
    };

    let count = 1;
    let transactions = [];
    let next = "";
    for (;;) {
        if (next) {
            Object.assign(query, {
                next,
            });
        }

        let queryParams = new URLSearchParams(query);
        let search = queryParams.toString();
        let url = `https://api.one.app/banking/pockets/${pocketId}/transaction/all?${search}`;
        let resp = await API._request(url);
        if (!resp.ok) {
            let msg = await resp.text();
            throw new Error(`list transactions failed: ${resp.status} ${msg}`);
        }
        let data = await resp.json();

        for (let tx of data.transactions) {
            if (tx.trn_id === latestTrnId) {
                return transactions;
            }
            transactions.push(tx);
        }
        if (!data.next) {
            return transactions;
        }

        let rnd = API._random(2000, 5000);
        await API._sleep(rnd);
        console.warn(
            `DEBUG page ${count} (${limit} items per page), first tx: ${data.transactions[0].trn_id}`
        );
        count += 1;
        next = data.next;
    }

    return transactions;
};

API.transfer = async function (originId, destinationId, amount) {
    let url = "https://api.one.app/banking/command";

    let originType = originId.replace(/\..*/, "");
    let destinationType = destinationId.replace(/\..*/, "");

    let isInternal = originType === "pocket" && destinationType === "pocket";
    let isOutbound =
        originType === "pocket" && destinationType === "plaid_linked_account";
    let isInbound =
        originType === "plaid_linked_account" && destinationType === "pocket";

    let data;
    if (isInternal) {
        data = {
            origin_pocket_id: originId,
            destination_pocket_id: destinationId,
            amount: amount,
            command_name: "TRANSFER_FUNDS_OWNED_POCKET",
        };
    } else if (isOutbound) {
        data = {
            amount: amount,
            pocket_id: originId,
            linked_account_id: destinationId,
            command_name: "DEBIT_POCKET_TO_LINKED_ACCOUNT",
        };
    } else if (isInbound) {
        throw new Error(
            `transfer type '${originType}' => '${destinationType}' isn't implemented yet`
        );
    } else {
        throw new Error(
            `unknown transfer type '${originType}' => '${destinationType}'`
        );
    }

    let resp = await API._request(url, data);
    if (!resp.ok) {
        let msg = await resp.text();
        throw new Error(`transfer failed: ${resp.status} ${msg}`);
    }

    // NO CONTENT
};

/**
 * @param {Number} min
 * @param {Number} max
 */
API._random = function (min, max) {
    let range = max + -min + 1;
    let rndF = Math.random();
    let rndScaled = rndF * range;
    let rndInt = Math.floor(rndScaled);
    let minRnd = rndInt + min;
    return minRnd;
};

/** @param {Number} ms */
API._sleep = function (ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
};

export default API;
