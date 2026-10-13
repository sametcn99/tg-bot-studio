import React, { useMemo, useState } from 'react';
import {
  Box,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

export interface Column<T> {
  id: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  getValue?: (row: T) => unknown;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  keyField: keyof T | ((row: T) => string | number);
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
  emptyMessage?: string;
  ariaLabel?: string;
}

type Order = 'asc' | 'desc';

export default function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  keyField,
  searchable = true,
  searchPlaceholder = 'Search records...',
  searchFilter,
  rowsPerPageOptions = [10, 25, 50],
  defaultRowsPerPage = 10,
  emptyMessage = 'No records found',
  ariaLabel = 'Data table',
}: DataTableProps<T>): React.ReactElement {
  const [searchTerm, setSearchTerm] = useState('');
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const q = searchTerm.toLowerCase().trim();
    if (searchFilter) {
      return rows.filter((row) => searchFilter(row, q));
    }
    // Default search across all properties or column getters
    return rows.filter((row) => {
      return columns.some((col) => {
        const val = col.getValue ? col.getValue(row) : row[col.id];
        return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
      });
    });
  }, [rows, searchTerm, searchFilter, columns]);

  const sortedRows = useMemo(() => {
    if (!orderBy) return filteredRows;
    const col = columns.find((c) => c.id === orderBy);
    return [...filteredRows].sort((a, b) => {
      const aVal = col?.getValue ? col.getValue(a) : a[orderBy];
      const bVal = col?.getValue ? col.getValue(b) : b[orderBy];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison: number;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }
      return order === 'desc' ? -comparison : comparison;
    });
  }, [filteredRows, orderBy, order, columns]);

  const paginatedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [sortedRows, page, rowsPerPage]);

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const getKey = (row: T): string | number => {
    if (typeof keyField === 'function') return keyField(row);
    return row[keyField];
  };

  return (
    <Box>
      {searchable && (
        <Box sx={{ mb: 2 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(0);
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
      )}

      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ overflowX: 'auto', borderRadius: 2 }}
      >
        <Table size="small" aria-label={ariaLabel}>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align ?? 'left'}
                  sortDirection={orderBy === col.id ? order : false}
                >
                  {col.sortable !== false ? (
                    <TableSortLabel
                      active={orderBy === col.id}
                      direction={orderBy === col.id ? order : 'asc'}
                      onClick={() => handleRequestSort(col.id)}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.map((row) => (
              <TableRow key={getKey(row)} hover>
                {columns.map((col) => (
                  <TableCell key={col.id} align={col.align ?? 'left'}>
                    {col.render
                      ? col.render(row)
                      : String(col.getValue ? (col.getValue(row) ?? '') : (row[col.id] ?? ''))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {paginatedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={rowsPerPageOptions}
          component="div"
          count={sortedRows.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </TableContainer>
    </Box>
  );
}
