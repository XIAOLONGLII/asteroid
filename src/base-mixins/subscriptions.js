/*
*   The subscriptions mixin:
*   - defines the `subscribe` and `unsubscribe` methods, used to send ddp `sub`
*     and `unsub` messages to the server. In order to do so - due to the
*     asynchronicity of the ddp sub and unsub calls - it must maintain a cache
*     (under the `subscriptions.cache` property of the Asteroid instance) of ddp
*     subscriptions. The cache is then used to match ddp `ready` and `nosub`
*     messages received from the server, and to restart active subscriptions in
*     the event of a reconnection (since Meteor does not support resuming ddp
*     sessions, as of version 1.2.0.2)
*/

import assign from "lodash.assign";
import EventEmitter from "wolfy87-eventemitter";

import SubscriptionCache from "../common/subscription-cache";
import fingerprintSub from "../common/fingerprint-sub";

/*
*   Private methods: they are invoked with the asteroid instance as context, but
*   they are not exported so they don't clutter the Asteroid class prototype.
*/

function restartSubscription (sub) {
    // Only restart the subscription if it isn't still in ddp's queue.
    if (!sub.stillInQueue) {
        // Handlers to ddp's connected event are invoked asynchronously (see
        // https://github.com/mondora/ddp.js/blob/master/src/ddp.js#L20).
        // Therefore there is a (very very small) chance that between the time
        // when the connected message is received and the time when the
        // connected handler is invoked, the ddp instance disconnected.
        // Therefore we update the stillInQueue status fo the subscription
        this.ddp.sub(sub.name, sub.params, sub.id);
        sub.stillInQueue = (this.ddp.status !== "connected");
    } else {
        // Since we're restarting subscriptions after a connection, we know
        // that now the subscriptions which were in ddp's queue will be sent,
        // therefore we need to remove the stillInQueue flag from them
        sub.stillInQueue = false;
    }
}

/*
*   Public methods
*/

export function subscribe (name, ...params) {
    const fingerprint = fingerprintSub(name, params);
    var sub = this.subscriptions.cache.get(fingerprint);
    if (!sub) {
        // If there is no cached subscription, subscribe
        const id = this.ddp.sub(name, params);
        // ddp.js enqueues messages to send if a connection has not yet been
        // established. Upon connection, when subscriptions are restarted, we
        // don't want to restart those subscriptions which had been made when
        // the connection had not yet been established, and therefore are still
        // in the queue. For this reason, we save ddp's connection status onto
        // the subscription object and we check it later to decide wether to
        // restart the subscription or not.
        const stillInQueue = (this.ddp.status !== "connected");
        // Build the subscription object and save it in the cache
        sub = assign(
            new EventEmitter(),
            {fingerprint, id, name, params, stillInQueue}
        );
        this.subscriptions.cache.add(sub);
    }
    // Return the subscription object
    return sub;
}

export function unsubscribe (id) {
    this.ddp.unsub(id);
}

/*
*   Init method
*/

export function init () {
    this.subscriptions = {
        cache: new SubscriptionCache()
    };
    this.ddp
        .on("ready", ({subs}) => {
            subs.forEach(id => {
                this.subscriptions.cache.get(id).emit("ready");
            });
        })
        .on("nosub", ({error, id}) => {
            if (error) {
                this.subscriptions.cache.get(id).emit("error", error);
            }
            this.subscriptions.cache.del(id);
        })
        .on("connected", () => {
            this.subscriptions.cache.forEach(restartSubscription.bind(this));
        });
}
