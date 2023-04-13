// const defaultTypes = require('./configs/defaultTypes');
// const types = require('./configs/types');
// const templates = require('./configs/templates');
// const getAdditionalOptions = require('./helpers/getAdditionalOptions');
const dropStatementProxy = require('./helpers/dropStatementProxy');

module.exports = (baseProvider, options, app) => {
	const _ = app.require('lodash');
	const {
		tab,
		commentIfDeactivated,
		checkAllKeysDeactivated,
		divideIntoActivatedAndDeactivated,
		hasType,
		wrap,
		clean,
		getDifferentProperties,
	} = app.require('@hackolade/ddl-fe-utils').general;
	const { assignTemplates, compareGroupItems } = app.require('@hackolade/ddl-fe-utils');

	const { getTableName, getTableOptions, getPartitions, getViewData, getCharacteristics, escapeQuotes } =
		require('./helpers/general')(_, wrap);

	const additionalOptions = getAdditionalOptions(options.additionalOptions);

	return dropStatementProxy({ commentIfDeactivated })(additionalOptions.applyDropStatements, {
		createDatabase({
			databaseName,
			ifNotExist,
			collation,
			characterSet,
			encryption,
			udfs,
			procedures,
			tablespaces,
			useDb = true,
		}) {
			let dbOptions = '';
			dbOptions += characterSet ? tab(`\nCHARACTER SET = '${characterSet}'`) : '';
			dbOptions += collation ? tab(`\nCOLLATE = '${collation}'`) : '';
			dbOptions += encryption ? tab(`\nENCRYPTION = 'Y'`) : '';

			const databaseStatement = assignTemplates(templates.createDatabase, {
				name: databaseName,
				ifNotExist: ifNotExist ? ' IF NOT EXISTS' : '',
				dbOptions: dbOptions,
				useDb: useDb ? `USE \`${databaseName}\`;\n` : '',
			});
			const udfStatements = udfs.map(udf => this.createUdf(databaseName, udf));
			const procStatements = procedures.map(procedure => this.createProcedure(databaseName, procedure));
			const tableSpaceStatements = tablespaces.map(tableSpace => this.createTableSpace(tableSpace)).filter(Boolean);

			return [...tableSpaceStatements, databaseStatement, ...udfStatements, ...procStatements].join('\n');
		},

		dropDatabase(dropDbData) {
			return assignTemplates(templates.dropDatabase, dropDbData);
		},

		alterDatabase(alterDbData) {
			const alterStatements = [];
			const databaseName = alterDbData.name;

			if (additionalOptions.excludeContainerAlterStatements) {
				return '';
			}

			if (alterDbData.collation || alterDbData.characterSet) {
				alterStatements.push(
					assignTemplates(templates.alterDatabaseCharset, {
						name: databaseName,
						characterSet: alterDbData.characterSet,
						collation: alterDbData.collation,
					}),
				);
			}

			if (alterDbData.encryption) {
				alterStatements.push(
					assignTemplates(templates.alterDatabaseEncryption, {
						name: databaseName,
						encryption: alterDbData.encryption,
					}),
				);
			}

			if (!_.isEmpty(alterDbData.udfs?.deleted)) {
				alterDbData.udfs?.deleted.forEach((udf) => {
					alterStatements.push(this.dropUdf(databaseName, udf));
				});
			}

			if (!_.isEmpty(alterDbData.udfs?.added)) {
				alterDbData.udfs.added.forEach((udf) => {
					alterStatements.push(this.createUdf(databaseName, udf));
				});
			}

			if (!_.isEmpty(alterDbData.udfs?.modified)) {
				alterDbData.udfs.modified.forEach((udf) => {
					alterStatements.push(
						this.dropUdf(databaseName, udf.old) + '\n' +
						this.createUdf(databaseName, udf.new),
					);
				});
			}

			if (!_.isEmpty(alterDbData.procedures?.deleted)) {
				alterDbData.procedures?.deleted.forEach((procedure) => {
					alterStatements.push(this.dropProcedure(databaseName, procedure));
				});
			}

			if (!_.isEmpty(alterDbData.procedures?.added)) {
				alterDbData.procedures.added.forEach((procedure) => {
					alterStatements.push(this.createProcedure(databaseName, procedure));
				});
			}

			if (!_.isEmpty(alterDbData.procedures?.modified)) {
				alterDbData.procedures.modified.forEach((procedure) => {
					alterStatements.push(
						this.dropProcedure(databaseName, procedure.old) + '\n' +
						this.createProcedure(databaseName, procedure.new),
					);
				});
			}

			return alterStatements.join('\n\n');
		},

		createTableSpace(tableSpace) {
			if (!tableSpace.name || !tableSpace.DATAFILE) {
				return '';
			}

			if (tableSpace.ENGINE === 'NDB' && !tableSpace.LOGFILE_GROUP) {
				return '';
			}

			let statement = '';

			if (tableSpace.ENGINE === 'NDB') {
				statement = assignTemplates(templates.createTableSpace, {
					undo: tableSpace.UNDO ? ' UNDO' : '',
					name: tableSpace.name,
					file: wrap(tableSpace.DATAFILE, '\'', '\''),
					AUTOEXTEND_SIZE: tableSpace.AUTOEXTEND_SIZE ? ` AUTOEXTEND_SIZE=${tableSpace.AUTOEXTEND_SIZE}` : '',
					logFile: ` USE LOGFILE GROUP ${tableSpace.LOGFILE_GROUP}`,
					EXTENT_SIZE: tableSpace.EXTENT_SIZE ? ` EXTENT_SIZE=${tableSpace.EXTENT_SIZE}` : '',
					INITIAL_SIZE: tableSpace.INITIAL_SIZE ? ` INITIAL_SIZE=${tableSpace.INITIAL_SIZE}` : '',
					ENGINE: ' ENGINE=NDB',
				});
			} else {
				statement = assignTemplates(templates.createTableSpace, {
					undo: tableSpace.UNDO ? ' UNDO' : '',
					name: tableSpace.name,
					file: wrap(tableSpace.DATAFILE, '\'', '\''),
					AUTOEXTEND_SIZE: tableSpace.AUTOEXTEND_SIZE ? ` AUTOEXTEND_SIZE=${tableSpace.AUTOEXTEND_SIZE}` : '',
					FILE_BLOCK_SIZE: tableSpace.FILE_BLOCK_SIZE ? ` FILE_BLOCK_SIZE=${tableSpace.FILE_BLOCK_SIZE}` : '',
					ENCRYPTION: tableSpace.ENCRYPTION ? ` ENCRYPTION=${tableSpace.ENCRYPTION}` : '',
					ENGINE: ' ENGINE=InnoDB',
				});
			}

			return commentIfDeactivated(statement, { isActivated: tableSpace.isActivated }) + '\n';
		},

		createUdf(databaseName, udf) {
			const characteristics = getCharacteristics(udf.characteristics);
			let startDelimiter = udf.delimiter ? `DELIMITER ${udf.delimiter}\n` : '';
			let endDelimiter = udf.delimiter ? `DELIMITER ;\n` : '';

			return (
				startDelimiter +
				assignTemplates(templates.createFunction, {
					name: getTableName(udf.name, databaseName),
					definer: udf.definer ? `DEFINER=${udf.definer} ` : '',
					ifNotExist: udf.ifNotExist ? 'IF NOT EXISTS ' : '',
					characteristics: characteristics.join('\n\t'),
					type: udf.type,
					parameters: udf.parameters,
					body: udf.body,
					delimiter: udf.delimiter || ';',
				}) +
				endDelimiter
			);
		},

		createProcedure(databaseName, procedure) {
			const characteristics = getCharacteristics(procedure.characteristics);
			let startDelimiter = procedure.delimiter ? `DELIMITER ${procedure.delimiter}\n` : '';
			let endDelimiter = procedure.delimiter ? `DELIMITER ;\n` : '';

			return (
				startDelimiter +
				assignTemplates(templates.createProcedure, {
					name: getTableName(procedure.name, databaseName),
					ifNotExist: procedure.ifNotExist ? 'IF NOT EXISTS ' : '',
					definer: procedure.definer ? `DEFINER=${procedure.definer} ` : '',
					parameters: procedure.parameters,
					characteristics: characteristics.join('\n\t'),
					body: procedure.body,
					delimiter: procedure.delimiter || ';',
				}) +
				endDelimiter
			);
		},

		dropUdf(databaseName, udf) {
			return assignTemplates(templates.dropUdf, { name: getTableName(udf.name, databaseName) });
		},

		dropProcedure(databaseName, procedure) {
			return assignTemplates(templates.dropProcedure, { name: getTableName(procedure.name, databaseName) });
		},

		createTable(
			{
				name,
				columns,
				dbData,
				temporary,
				ifNotExist,
				likeTableName,
				selectStatement,
				options,
				partitioning,
				checkConstraints,
				foreignKeyConstraints,
				keyConstraints,
				selectIgnore,
				selectReplace,
			},
			isActivated,
		) {
			const tableName = getTableName(name, dbData.databaseName);
			const temporaryTable = temporary ? 'TEMPORARY ' : '';
			const ifNotExistTable = ifNotExist ? 'IF NOT EXISTS ' : '';

			if (likeTableName) {
				return commentIfDeactivated(assignTemplates(templates.createLikeTable, {
					name: tableName,
					likeTableName: getTableName(likeTableName, dbData.databaseName),
					temporary: temporaryTable,
					ifNotExist: ifNotExistTable,
				}), { isActivated });
			}

			const dividedKeysConstraints = divideIntoActivatedAndDeactivated(
				keyConstraints.map(createKeyConstraint(templates, isActivated)),
				key => key.statement,
			);
			const keyConstraintsString = generateConstraintsString(dividedKeysConstraints, isActivated);

			const dividedForeignKeys = divideIntoActivatedAndDeactivated(foreignKeyConstraints, key => key.statement);
			const foreignKeyConstraintsString = generateConstraintsString(dividedForeignKeys, isActivated);
			const ignoreReplace = selectStatement ? selectIgnore ? ' IGNORE' : selectReplace ? ' REPLACE' : '' : '';

			const tableStatement = assignTemplates(templates.createTable, {
				name: tableName,
				column_definitions: columns.join(',\n\t'),
				selectStatement: selectStatement ? ` AS ${selectStatement}` : '',
				temporary: temporaryTable,
				ifNotExist: ifNotExistTable,
				options: getTableOptions(options),
				partitions: getPartitions(partitioning),
				checkConstraints: checkConstraints.length ? ',\n\t' + checkConstraints.join(',\n\t') : '',
				foreignKeyConstraints: foreignKeyConstraintsString,
				keyConstraints: keyConstraintsString,
				ignoreReplace,
			});

			return commentIfDeactivated(tableStatement, { isActivated });
		},

		dropTable({ name, dbName, temporary }) {
			return assignTemplates(templates.dropTable, {
				name: getTableName(name, dbName),
				temporary: temporary ? ' TEMPORARY' : '',
			});
		},

		alterTable({ name, collationOptions }, dbData) {
			const table = getTableName(name, dbData.databaseName);

			if (!collationOptions) {
				return '';
			}

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(
					templates.alterCharset,
					{
						charset: collationOptions.characterSet,
						default: collationOptions.defaultCharSet ? 'DEFAULT ' : '',
						collation: collationOptions.collation ? ` COLLATE='${collationOptions.collation}'` : '',
					},
				),
			});
		},

		convertColumnDefinition(columnDefinition) {
			const type = _.toUpper(columnDefinition.type);
			const notNull = columnDefinition.nullable ? '' : ' NOT NULL';
			const primaryKey = columnDefinition.primaryKey
				? ' ' + createKeyConstraint(templates, true)(columnDefinition.primaryKeyOptions).statement
				: '';
			const unique = columnDefinition.unique
				? ' ' + createKeyConstraint(templates, true)(columnDefinition.uniqueKeyOptions).statement
				: '';
			const zeroFill = columnDefinition.zerofill ? ' ZEROFILL' : '';
			const autoIncrement = columnDefinition.autoIncrement ? ' AUTO_INCREMENT' : '';
			const invisible = columnDefinition.invisible ? ' INVISIBLE' : '';
			const national = columnDefinition.national && canBeNational(type) ? 'NATIONAL ' : '';
			const comment = columnDefinition.comment ? ` COMMENT '${escapeQuotes(columnDefinition.comment)}'` : '';
			const charset = type !== 'JSON' && columnDefinition.charset ? ` CHARSET ${columnDefinition.charset}` : '';
			const collate =
				type !== 'JSON' && columnDefinition.charset && columnDefinition.collation
					? ` COLLATE ${columnDefinition.collation}`
					: '';
			const generatedDefaultValue = createGeneratedColumn(columnDefinition.generatedDefaultValue);
			const defaultValue = (!_.isUndefined(columnDefinition.default) && !generatedDefaultValue)
				? ' DEFAULT ' + decorateDefault(type, columnDefinition.default)
				: '';
			const compressed = columnDefinition.compressionMethod
				? ` COMPRESSED=${columnDefinition.compressionMethod}`
				: '';
			const signed = getSign(type, columnDefinition.signed);

			return commentIfDeactivated(
				assignTemplates(templates.columnDefinition, {
					name: columnDefinition.name,
					type: decorateType(type, columnDefinition),
					not_null: notNull,
					primary_key: primaryKey,
					unique_key: unique,
					default: defaultValue,
					generatedDefaultValue,
					autoIncrement,
					compressed,
					signed,
					zeroFill,
					invisible,
					comment,
					national,
					charset,
					collate,
				}),
				{
					isActivated: columnDefinition.isActivated,
				},
			);
		},

		addColumn(tableName, columnDefinition, dbData) {
			const table = getTableName(tableName, dbData.databaseName);

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(templates.addColumn, {
					columnDefinition: this.convertColumnDefinition(columnDefinition),
				}),
			});
		},

		dropColumn(tableName, columnData, dbData) {
			const table = getTableName(tableName, dbData.databaseName);

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(templates.dropColumn, {
					name: wrap(columnData.name, '`', '`'),
				}),
			});
		},

		alterColumn(tableName, columnData, dbData) {
			const table = getTableName(tableName, dbData.databaseName);
			let alterStatement = '';

			if (columnData.oldName && !columnData.newOptions) {
				alterStatement = assignTemplates(templates.renameColumn, {
					oldName: wrap(columnData.oldName, '`', '`'),
					newName: wrap(columnData.name, '`', '`'),
				});
			} else if (columnData.oldName && columnData.newOptions) {
				alterStatement = assignTemplates(templates.changeColumn, {
					oldName: wrap(columnData.oldName, '`', '`'),
					columnDefinition: this.convertColumnDefinition({ ...columnData, isActivated: true }),
				});
			} else {
				alterStatement = assignTemplates(templates.modifyColumn, {
					columnDefinition: this.convertColumnDefinition({ ...columnData, isActivated: true }),
				});
			}

			return commentIfDeactivated(assignTemplates(templates.alterTable, {
				table,
				alterStatement,
			}), { isActivated: columnData.isActivated });
		},

		createIndex(tableName, index, dbData, isParentActivated = true, jsonSchema) {
			if ((_.isEmpty(index.indxKey) && _.isEmpty(index.indxExpression)) || !index.indxName) {
				return '';
			}

			const allDeactivated = checkAllKeysDeactivated(index.indxKey || []);
			const wholeStatementCommented = index.isActivated === false || !isParentActivated || allDeactivated;
			const indexType = index.indexType && _.toUpper(index.indexType) !== 'KEY' ? `${_.toUpper(index.indexType)} ` : '';
			const name = wrap(index.indxName || '', '`', '`');
			const table = getTableName(tableName, dbData.databaseName);
			const indexCategory = index.indexCategory ? ` USING ${index.indexCategory}` : '';
			let indexOptions = [];

			const dividedKeys = divideIntoActivatedAndDeactivated(
				index.indxKey || [],
				key => processIndexKeyName({ name: key.name, type: key.type, jsonSchema }),
			);
			const commentedKeys = dividedKeys.deactivatedItems.length
				? commentIfDeactivated(dividedKeys.deactivatedItems.join(', '), {
						isActivated: wholeStatementCommented,
						isPartOfLine: true,
				  })
				: '';
			const expressionKeys = (index.indxExpression || []).map(item => item.value?.replace(/\\/g, '\\\\')).filter(Boolean);

			if (index.indxKeyBlockSize) {
				indexOptions.push(`KEY_BLOCK_SIZE = ${index.indxKeyBlockSize}`);
			}

			if (index.indexType === 'FULLTEXT' && index.indxParser) {
				indexOptions.push(`WITH PARSER ${index.indxParser}`);
			}

			if (index.indexComment) {
				indexOptions.push(`COMMENT '${escapeQuotes(index.indexComment)}'`);
			}

			if (index.indxVisibility) {
				indexOptions.push(index.indxVisibility);
			}

			if (index.indexLock) {
				indexOptions.push(`LOCK ${index.indexLock}`);
			} else if (index.indexAlgorithm) {
				indexOptions.push(`ALGORITHM ${index.indexAlgorithm}`);
			}

			const indexStatement = assignTemplates(templates.index, {
				keys: expressionKeys.length ? `${expressionKeys.join(', ')}` :
					dividedKeys.activatedItems.join(', ') +
					(wholeStatementCommented && commentedKeys && dividedKeys.activatedItems.length
						? ', ' + commentedKeys
						: commentedKeys),
				indexOptions: indexOptions.length ? '\n\t' + indexOptions.join('\n\t') : '',
				name,
				table,
				indexType,
				indexCategory,
			});

			if (wholeStatementCommented) {
				return commentIfDeactivated(indexStatement, { isActivated: false });
			} else {
				return indexStatement;
			}
		},

		dropIndex(tableName, indexData, dbData) {
			if (!indexData.indxName) {
				return '';
			}

			const table = getTableName(tableName, dbData.databaseName);
			const indexName = wrap(indexData.indxName, '`', '`');

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(templates.dropIndex, { indexName }),
			});
		},

		alterIndex(tableName, { new: newIndexData, old: oldIndexData }, dbData) {
			return [
				this.dropIndex(tableName, oldIndexData, dbData),
				this.createIndex(tableName, {
					...newIndexData,
					indxKey: newIndexData.indxKey.filter(key => !(key.isActivated === false))
				}, dbData),
			].join('\n');
		},

		createCheckConstraint(checkConstraint) {
			return assignTemplates(templates.checkConstraint, {
				name: checkConstraint.name ? `${wrap(checkConstraint.name, '`', '`')} ` : '',
				expression: _.trim(checkConstraint.expression).replace(/^\(([\s\S]*)\)$/, '$1'),
				enforcement: checkConstraint.enforcement ? ` ${checkConstraint.enforcement}` : '',
			});
		},

		createCheckConstraintStatement(tableName, checkConstraint, dbData) {
			const table = getTableName(tableName, dbData.databaseName);

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(templates.addCheckConstraint, {
					checkConstraint: this.createCheckConstraint(checkConstraint),
				}),
			});
		},

		dropCheckConstraint(tableName, checkConstraint, dbData) {
			const table = getTableName(tableName, dbData.databaseName);

			return assignTemplates(templates.alterTable, {
				table,
				alterStatement: assignTemplates(templates.dropCheckConstraint, {
					name: wrap(checkConstraint.name, '`', '`'),
				}),
			});
		},

		alterCheckConstraint(tableName, { new: newCheck, old: oldCheck }, dbData) {
			return [
				this.dropCheckConstraint(tableName, oldCheck, dbData),
				this.createCheckConstraintStatement(tableName, newCheck, dbData),
			].join('\n');
		},

		createForeignKeyConstraint(
			{ name, foreignKey, primaryTable, primaryKey, primaryTableActivated, foreignTableActivated },
			dbData,
		) {
			const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
			const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);
			const isActivated =
				!isAllPrimaryKeysDeactivated &&
				!isAllForeignKeysDeactivated &&
				primaryTableActivated &&
				foreignTableActivated;

			return {
				statement: assignTemplates(templates.createForeignKeyConstraint, {
					primaryTable: getTableName(primaryTable, dbData.databaseName),
					name,
					foreignKey: isActivated ? foreignKeysToString(foreignKey) : foreignActiveKeysToString(foreignKey),
					primaryKey: isActivated ? foreignKeysToString(primaryKey) : foreignActiveKeysToString(primaryKey),
				}),
				isActivated,
			};
		},

		createForeignKey(
			{ name, foreignTable, foreignKey, primaryTable, primaryKey, primaryTableActivated, foreignTableActivated },
			dbData,
		) {
			const isAllPrimaryKeysDeactivated = checkAllKeysDeactivated(primaryKey);
			const isAllForeignKeysDeactivated = checkAllKeysDeactivated(foreignKey);

			return {
				statement: assignTemplates(templates.createForeignKey, {
					primaryTable: getTableName(primaryTable, dbData.databaseName),
					foreignTable: getTableName(foreignTable, dbData.databaseName),
					name,
					foreignKey: foreignKeysToString(foreignKey),
					primaryKey: foreignKeysToString(primaryKey),
				}),
				isActivated:
					!isAllPrimaryKeysDeactivated &&
					!isAllForeignKeysDeactivated &&
					primaryTableActivated &&
					foreignTableActivated,
			};
		},

		createView(viewData, dbData, isActivated) {
			const { deactivatedWholeStatement, selectStatement } = this.viewSelectStatement(viewData, isActivated, dbData);

			const algorithm =
				viewData.algorithm && viewData.algorithm !== 'UNDEFINED' ? `ALGORITHM=${viewData.algorithm} ` : '';

			return commentIfDeactivated(
				assignTemplates(templates.createView, {
					name: getTableName(viewData.name, dbData.databaseName),
					orReplace: viewData.orReplace ? 'OR REPLACE ' : '',
					ifNotExist: viewData.ifNotExist ? 'IF NOT EXISTS ' : '',
					sqlSecurity: viewData.sqlSecurity ? `SQL SECURITY ${viewData.sqlSecurity} ` : '',
					checkOption: viewData.checkOption ? `\nWITH ${viewData.checkOption} CHECK OPTION` : '',
					selectStatement,
					algorithm,
				}),
				{ isActivated: !deactivatedWholeStatement },
			);
		},

		viewSelectStatement(viewData, isActivated = true, dbData) {
			const allDeactivated = checkAllKeysDeactivated(viewData.keys || []);
			const deactivatedWholeStatement = allDeactivated || !isActivated;
			const { columns, tables } = getViewData(viewData.keys, dbData.databaseName);
			let columnsAsString = columns.map(column => column.statement).join(',\n\t\t');

			if (!deactivatedWholeStatement) {
				const dividedColumns = divideIntoActivatedAndDeactivated(columns, column => column.statement);
				const deactivatedColumnsString = dividedColumns.deactivatedItems.length
					? commentIfDeactivated(dividedColumns.deactivatedItems.join(',\n\t\t'), {
							isActivated: false,
							isPartOfLine: true,
					  })
					: '';
				columnsAsString = dividedColumns.activatedItems.join(',\n\t\t') + deactivatedColumnsString;
			}

			const selectStatement = _.trim(viewData.selectStatement)
				? _.trim(tab(viewData.selectStatement))
				: assignTemplates(templates.viewSelectStatement, {
						tableName: tables.join(', '),
						keys: columnsAsString,
				  });

			return { deactivatedWholeStatement, selectStatement };
		},

		dropView({ name, dbData }) {
			const viewName = getTableName(name, dbData.databaseName);

			return assignTemplates(templates.dropView, {
				viewName,
			});
		},

		alterView(alterData, dbData) {
			if (_.isEmpty(alterData.options)) {
				return '';
			}

			const viewName = getTableName(alterData.name, dbData.databaseName);
			const { selectStatement } = this.viewSelectStatement(alterData, true, dbData);
			const options = alterData.options || {};

			return assignTemplates(templates.alterView, {
				name: viewName,
				selectStatement,
				algorithm: options.algorithm && options.algorithm !== 'UNDEFINED' ? ` ALGORITHM=${options.algorithm}` : '',
				sqlSecurity: options.sqlSecurity ? ` SQL SECURITY ${options.sqlSecurity}` : '',
				checkOption: options.checkOption ? `\nWITH ${options.checkOption} CHECK OPTION` : '',
			});
		},

		createViewIndex(viewName, index, dbData, isParentActivated) {
			return '';
		},

		createUdt(udt, dbData) {
			return '';
		},

		getDefaultType(type) {
			return defaultTypes[type];
		},

		getTypesDescriptors() {
			return types;
		},

		hasType(type) {
			return hasType(types, type);
		},

		hydrateColumn({ columnDefinition, jsonSchema, dbData }) {
			return {
				name: columnDefinition.name,
				type: columnDefinition.type,
				primaryKey: keyHelper.isInlinePrimaryKey(jsonSchema),
				primaryKeyOptions: _.omit(keyHelper.hydratePrimaryKeyOptions(jsonSchema.primaryKeyOptions || {}), 'columns'),
				unique: keyHelper.isInlineUnique(jsonSchema),
				uniqueKeyOptions: _.omit(keyHelper.hydrateUniqueOptions(_.first(jsonSchema.uniqueKeyOptions) || {}), 'columns'),
				nullable: columnDefinition.nullable,
				default: columnDefinition.default,
				comment: columnDefinition.description || jsonSchema.refDescription || jsonSchema.description,
				isActivated: columnDefinition.isActivated,
				length: columnDefinition.enum,
				scale: columnDefinition.scale,
				precision: columnDefinition.precision,
				length: columnDefinition.length,
				national: jsonSchema.national,
				autoIncrement: jsonSchema.autoincrement,
				zerofill: jsonSchema.zerofill,
				invisible: jsonSchema.invisible,
				compressionMethod: jsonSchema.compressed ? jsonSchema.compression_method : '',
				enum: jsonSchema.enum,
				synonym: jsonSchema.synonym,
				signed: jsonSchema.zerofill || jsonSchema.signed,
				microSecPrecision: jsonSchema.microSecPrecision,
				charset: jsonSchema.characterSet,
				collation: jsonSchema.collation,
				generatedDefaultValue: jsonSchema.generatedDefaultValue,
			};
		},

		hydrateDropColumn({ name }) {
			return {
				name,
			};
		},

		hydrateAlterColumn({
			newColumn,
			oldColumn,
			newColumnSchema,
			oldColumnSchema,
			oldCompData,
			newCompData,
		}) {
			const diff = getDifferentProperties(newColumn, oldColumn, ['name', 'type']);

			const result = {...newColumn};

			if (oldCompData.name !== newCompData.name) {
				result.oldName = oldCompData.name;
			}

			if (oldCompData.type !== newCompData.type) {
				result.oldType = oldCompData.type;
			}

			if (!_.isEmpty(diff)) {
				result.newOptions = diff;
			}

			return result;
		},

		hydrateIndex(indexData, tableData) {
			return {
				indxName: indexData?.indxName || '',
				indxKey: indexData?.indxKey?.map(key => ({ name: key.name, type: key.type, isActivated: key.isActivated })),
				indxExpression: indexData?.indxExpression?.map(key => ({ value: key.value })),
				isActivated: indexData?.isActivated,
				indexType: indexData?.indexType,
				indexCategory: indexData?.indexCategory,
				indxKeyBlockSize: indexData?.indxKeyBlockSize,
				indxParser: indexData?.indxParser,
				indexComment: indexData?.indexComment,
				indxVisibility: indexData?.indxVisibility,
				indexLock: indexData?.indexLock,
				indexAlgorithm: indexData?.indexAlgorithm,
			};
		},

		hydrateViewIndex(indexData) {
			return {};
		},

		hydrateCheckConstraint(checkConstraint) {
			return {
				name: checkConstraint.chkConstrName,
				expression: checkConstraint.constrExpression,
				enforcement: checkConstraint.constrEnforcement,
			};
		},

		hydrateDatabase(containerData, data) {
			return {
				databaseName: containerData.name,
				ifNotExist: containerData.ifNotExist,
				characterSet: containerData.characterSet,
				collation: containerData.collation,
				encryption: containerData.ENCRYPTION === 'Yes' ? true : false,
				udfs: (data?.udfs || []).map(this.hydrateUdf),
				procedures: (data?.procedures || []).map(this.hydrateProcedure),
				tablespaces: (data?.modelData?.[2]?.tablespaces || []).map(this.hydrateTableSpace),
			};
		},

		hydrateTableSpace(tableSpace) {
			return {
				name: tableSpace.name,
				isActivated: tableSpace.isActivated,
				DATAFILE: tableSpace.DATAFILE,
				UNDO: tableSpace.UNDO,
				AUTOEXTEND_SIZE: tableSpace.AUTOEXTEND_SIZE,
				ENGINE: tableSpace.ENGINE,
				FILE_BLOCK_SIZE: tableSpace.UNDO ? '' : tableSpace.FILE_BLOCK_SIZE,
				ENCRYPTION: ({ 'Yes': 'Y', 'No': 'N' })[tableSpace.ENCRYPTION] || '',
				LOGFILE_GROUP: tableSpace.LOGFILE_GROUP,
				EXTENT_SIZE: tableSpace.EXTENT_SIZE,
				INITIAL_SIZE: tableSpace.INITIAL_SIZE,
			};
		},

		hydrateTable({ tableData, entityData, jsonSchema }) {
			const detailsTab = entityData[0];
			const likeTable = _.get(tableData, `relatedSchemas[${detailsTab.like}]`, '');

			return {
				...tableData,
				keyConstraints: keyHelper.getTableKeyConstraints({ jsonSchema }),
				temporary: detailsTab.temporary,
				ifNotExist: !detailsTab.orReplace && detailsTab.ifNotExist,
				likeTableName: likeTable?.code || likeTable?.collectionName,
				selectStatement: _.trim(detailsTab.selectStatement),
				options: { ...detailsTab.tableOptions, description: detailsTab.description },
				partitioning: detailsTab.partitioning,
				selectIgnore: detailsTab.selectIgnore,
				selectReplace: detailsTab.selectReplace,
			};
		},

		hydrateDropTable({ tableData, entityData }) {
			const detailsTab = entityData[0];

			return {
				name: tableData.name,
				dbName: tableData.dbData.databaseName,
				temporary: detailsTab?.temporary,
			};
		},

		hydrateViewColumn(data) {
			return {
				name: data.name,
				tableName: data.entityName,
				alias: data.alias,
				isActivated: data.isActivated,
			};
		},

		hydrateView({ viewData, entityData, relatedSchemas, relatedContainers }) {
			const detailsTab = entityData[0];

			return {
				name: viewData.name,
				keys: viewData.keys,
				orReplace: detailsTab.orReplace,
				ifNotExist: detailsTab.ifNotExist,
				selectStatement: detailsTab.selectStatement,
				sqlSecurity: detailsTab.SQL_SECURITY,
				algorithm: detailsTab.algorithm,
				checkOption: detailsTab.withCheckOption ? detailsTab.checkTestingScope : '',
			};
		},

		hydrateDropView({ tableData }) {
			return {
				name: tableData.name,
				dbData: tableData.dbData,
			};
		},

		hydrateAlterView({ name, newEntityData, oldEntityData, viewData, jsonSchema }) {
			const newData = this.hydrateView({
				viewData: {},
				entityData: newEntityData,
			});
			const oldData = this.hydrateView({
				viewData: {},
				entityData: oldEntityData,
			});
			const options = getDifferentProperties(newData, oldData);

			return {
				name,
				keys: viewData.keys,
				selectStatement: options.selectStatement || newEntityData[0]?.selectStatement,
				options,
			};
		},

		commentIfDeactivated(statement, data, isPartOfLine) {
			return statement;
		},

		hydrateUdf(udf) {
			return {
				name: udf.name,
				delimiter: udf.functionDelimiter,
				ifNotExist: udf.functionIfNotExist,
				definer: udf.functionDefiner,
				parameters: udf.functionArguments,
				type: udf.functionReturnType,
				characteristics: {
					sqlSecurity: udf.functionSqlSecurity,
					language: udf.functionLanguage,
					contains: udf.functionContains,
					deterministic: udf.functionDeterministic,
					comment: udf.functionDescription,
				},
				body: udf.functionBody,
			};
		},

		hydrateProcedure(procedure) {
			return {
				delimiter: procedure.delimiter,
				definer: procedure.definer,
				ifNotExist: procedure.procedureIfNotExist,
				name: procedure.name,
				parameters: procedure.inputArgs,
				body: procedure.body,
				characteristics: {
					comment: procedure.comments,
					contains: procedure.contains,
					language: procedure.language,
					deterministic: procedure.deterministic,
					sqlSecurity: procedure.securityMode,
				},
			};
		},

		hydrateDropDatabase(containerData) {
			return {
				name: containerData[0]?.name || '', 
			};
		},

		hydrateAlterDatabase({ containerData, compModeData }) {
			const data = containerData[0] || {};
			const isCharacterSetModified = compModeData.new.characterSet !== compModeData.old.characterSet;
			const isCollationModified = compModeData.new.collation !== compModeData.old.collation;
			const encryption = compModeData.new.ENCRYPTION !== compModeData.old.ENCRYPTION;
			const procedures = compareGroupItems(
				(compModeData.old.Procedures || []).map(this.hydrateProcedure),
				(compModeData.new.Procedures || []).map(this.hydrateProcedure),
			);
			const udfs = compareGroupItems(
				(compModeData.old.UDFs || []).map(this.hydrateUdf),
				(compModeData.new.UDFs || []).map(this.hydrateUdf),
			);
	
			return {
				name: data.name || '',
				...((isCharacterSetModified || isCollationModified) ? {
					characterSet: data.characterSet,
					collation: data.collation,
				} : {}),
				...(encryption ? { encryption: data.ENCRYPTION === 'Yes' ? 'Y' : 'N' } : {}),
				procedures,
				udfs,
			};
		},

		hydrateAlterTable({ name, newEntityData, oldEntityData, jsonSchema }) {
			const newDetailsTab = newEntityData[0];
			const oldDetailsTab = oldEntityData[0];
			const collationOptionsChanged = [
				'defaultCharSet',
				'characterSet',
				'collation',
			].some(
				optionName => oldDetailsTab.tableOptions?.[optionName] !== newDetailsTab.tableOptions?.[optionName],
			);

			return {
				name,
				collationOptions: collationOptionsChanged ? {
					defaultCharSet: newDetailsTab.tableOptions?.defaultCharSet,
					characterSet: newDetailsTab.tableOptions?.characterSet,
					collation: newDetailsTab.tableOptions?.collation,
				} : null,
			};
		},
	});
};