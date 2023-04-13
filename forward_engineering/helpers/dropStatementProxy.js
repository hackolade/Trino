const dropStatementProxy = ({ commentIfDeactivated }) => (applyDropStatements, ddlProvider) => {
	let hasDropStatements = false;

	return {
		...ddlProvider,
		...[
			'dropDatabase',
			'dropUdf',
			'dropProcedure',
			'dropTable',
			'dropColumn',
			'dropIndex',
			'dropCheckConstraint',
			'dropView',
		].reduce((result, method) => {
			return {
				...result,
				[method]: (...params) => {
					const script = ddlProvider[method](...params);
					hasDropStatements = hasDropStatements || Boolean(script);

					if (applyDropStatements) {
						return script;
					}

					if (!script) {
						return script;
					}

					return commentIfDeactivated(script, { isActivated: false });
				},
			}
		}, {}),
		isDropInStatements() {
			return hasDropStatements;
		},
	};
};

module.exports = dropStatementProxy;
