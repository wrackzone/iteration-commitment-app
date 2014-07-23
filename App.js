// Read snapshots for everything in the current iteration. 
// 'Current' snapshots are still in the iteration, show them on the left.
// For everything else, group by object id and get the last snapshot (latest value)
// show in  right hand view.
// Left:
// Show ID (link), Name, State, Owner, Size.
// Right:
// Show Iteration, ID (link), Name, State, Owner, Size
var app = null;

Ext.define('CustomApp', {
	extend: 'Rally.app.TimeboxScopedApp',
	scopeType: 'iteration',
	componentCls: 'app',
	// layout : 'column',
	// layout : "column",
	// items: [{ html:'<a href="https://help.rallydev.com/apps/2.0rc3/doc/">App SDK 2.0rc3 Docs</a>'}
	// ],
	launch: function() {
		app = this;
		this.reload();
	},
	onScopeChange : function() {
		app.reload();
	},
	reload : function() {
		var timeboxScope = app.getContext().getTimeboxScope();
		if (timeboxScope) {
			var record = timeboxScope.getRecord();
			var name = record.get('Name');
			var startDate = timeboxScope.getType() === 'iteration' ? 
				record.get('StartDate') : record.get('ReleaseStartDate');
			app.querySnapshotsForIteration( record.get("Name"));
		} else {
			app.querySnapshotsForIteration( "May 2014");
		}
	},

	querySnapshotsForIteration : function(name) {

		var config = {
			model : 'iteration',
			fetch : true,
			filters : [ { property:"Name", operator:"=", value: name } ]
		};

		async.map( [config], app._wsapiQuery, function(err,results) {
			var fetch = [ '_ValidFrom','_ValidTo','ObjectID', 'FormattedID', '_TypeHierarchy', 'Name','Iteration','PlanEstimate','Owner','ScheduleState']
			var hydrate =  ['_TypeHierarchy','ScheduleState']

			var iterationIds = _.map(results[0],function(i) { return i.get("ObjectID")});
			var configs = [
			{
					fetch : fetch,
					hydrate : hydrate,
					find : {
						'Iteration' : {"$in" : iterationIds}
					}
			}];

			async.map(configs,app._snapshotQuery,function(err,results) {

				var groupedById = _.groupBy( results[0], function (s) { return s.get("FormattedID")});
				var sorted = [];

				_.each( _.keys(groupedById), function(k) {
					var items = _.sortBy( groupedById[k], function(s) { 
						return moment(s.get("_ValidTo"));
					});
					sorted.push(_.last(items));
				});

				var deferred = _.filter( sorted,function(item) {
					return item.get("_ValidTo").indexOf("9999") === -1
				});

				var original = _.filter( sorted,function(item) {
					return item.get("_ValidTo").indexOf("9999") !== -1
				});

				var configs = [
				{
						fetch : fetch,
						hydrate : hydrate,
						find : {
							'__At' : "current",
							'ObjectID' : { "$in" : _.map(deferred,function(d){
								return d.get("ObjectID")
							}) }
						}
				}];

				async.map(configs,app._snapshotQuery,function(err,results) {

					var scopedOut = results[0];
					console.log("Deferred",scopedOut);
					console.log("Original",original);

					if ((scopedOut.length===0) && (original.length===0)) {
						Rally.ui.notify.Notifier.show({message: "No items to show!"});
						return;
					}

					var owners = _.compact(
						_.uniq( 
							_.map(_.union(original,scopedOut),function(s){ return s.get("Owner");})));

					var config1 = { 
						model : "User", 
						fetch : true, 
						filters : owners.length > 0 ? [app.createWsapiFilter(owners,"ObjectID")] : [],
						context : { project : null}
					};

					var iterations = _.compact(
							_.uniq( 
								_.map(_.union(original,scopedOut),function(s){ return s.get("Iteration");})));

					var config2 = { 
						model : "Iteration", 
						fetch : true, 
						filters : iterations.length > 0 ? [app.createWsapiFilter(iterations,"ObjectID")] : [],
						context : { project : null}
					};
					
					async.map( [config1,config2], app._wsapiQuery, 
						function(err,results) {
								app.owners = results[0];
								app.iterations = results[1];
								app.showOriginal(original);
								app.showDeferred(scopedOut);
						});
				});
			});
		});
	},

	createWsapiFilter : function( ids, propertyName ) {

		var filter = null;

		_.each( ids, function( id, i ) {
			var f = Ext.create('Rally.data.wsapi.Filter', {
					property : propertyName , operator : '=', value : id }
			);
			filter = (i===0) ? f : filter.or(f);
		});
		return filter;
	},

	showOriginal : function( snapshots ) {

		if (app.originalGrid)
			app.originalGrid.destroy();

		app.originalGrid = Ext.create('Rally.ui.grid.Grid', {
			store: Ext.create('Rally.data.custom.Store', {
			data: _.map(snapshots,function(s) { return s.data;})
		}),
		title : "Original Iteration Scope",
		columnCfgs: [
			{ text: 'Id', dataIndex: 'FormattedID' },
			{ text: 'Name', dataIndex: 'Name' },
			{ text: 'State', dataIndex: 'ScheduleState' },
			{ text: 'Size', dataIndex: 'PlanEstimate' },
			{ text: 'Owner', dataIndex: 'Owner', renderer : app.renderOwner }
		]
		});
		app.add(app.originalGrid);
	},

	showDeferred : function( snapshots ) {

		if (app.deferredGrid)
			app.deferredGrid.destroy();

		app.deferredGrid = Ext.create('Rally.ui.grid.Grid', {
			store: Ext.create('Rally.data.custom.Store', {
			data: _.map(snapshots,function(s) { return s.data;})
		}),
		title : "Deferred Items",
		columnCfgs: [
			{ text: 'Id', dataIndex: 'FormattedID' },
			{ text: 'Name', dataIndex: 'Name' },
			{ text: 'State', dataIndex: 'ScheduleState' },
			{ text: 'Size', dataIndex: 'PlanEstimate' },
			{ text: 'Iteration', dataIndex: 'Iteration', renderer : app.renderIteration },
			{ text: 'Owner', dataIndex: 'Owner', renderer : app.renderOwner }
		]
		});
		app.add(app.deferredGrid);
	},

	renderOwner : function(v,m,r ) {
		var owner = _.find(app.owners,function(o) { return o.get("ObjectID") === v});
		return (!_.isNull(owner) && !_.isUndefined(owner)) ? owner.get("UserName") : "";
	},

	renderIteration : function(v,m,r ) {
		var it = _.find(app.iterations,function(o) { return o.get("ObjectID") === v});
		return (!_.isNull(it) && !_.isUndefined(it)) ? it.get("Name") : v;
	},

	_snapshotQuery : function( config ,callback) {

		var storeConfig = {
			find    : config.find,
			fetch   : config.fetch,
			hydrate : config.hydrate,
			autoLoad : true,
			pageSize : 10000,
			limit    : 'Infinity',
			listeners : {
				scope : this,
				load  : function(store,snapshots,success) {
					callback(null,snapshots);
				}
			}
		};
		var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);

	},

	_wsapiQuery : function( config , callback ) {

		console.log("wsapi config",config);

		Ext.create('Rally.data.WsapiDataStore', {
			autoLoad : true,
			limit : "Infinity",
			model : config.model,
			fetch : config.fetch,
			filters : config.filters,
			listeners : {
				scope : this,
				load : function(store, data) {
					callback(null,data);
				}
			}
		});

	}

});
